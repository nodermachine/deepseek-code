# Harness Hardening TODO

Backlog for making deepseek-code robust with weaker models (V4-flash included) — not just when driven by a top-tier model. Ordered roughly by ROI.

Context: see the "为什么修复方向反了" retro in git log `ef13091` — a Flash-driven session confidently misdiagnosed a loader bug because the harness didn't push it to gather evidence, verify, or plan. The lesson: **Claude Code's smoothness comes from its process rails, not just its UX**. If we want an open-source parity, we need the rails too.

Each item lists rough effort + why it matters. Break these out into their own spec/plan when picked up.

---

## P0 — Ship-blockers for "usable with Flash"

### 1. Evidence-gathering language in system prompt

**Effort:** half a day
**Why:** The single biggest single-line ROI item. Prevents the "look at 1 file, diagnose the whole class" failure mode.

Add to `buildSystemPrompt` a section like:

> **Diagnosis protocol.** Before concluding what's broken:
> - If you see a mismatch between a file and a parser/consumer, grep ≥3 other files of the same class before deciding which side is aberrant.
> - If you see a count/list that seems too large or too small, count the ground truth (`ls`, `find`, `git ls-files`) before naming a cause.
> - "Confidence in a diagnosis is a function of tool calls invested, not sentence structure." Under 3 tool calls of investigation, hedge your language: "looks like", "possibly", "worth verifying" — not "the core problem is".

Files: `packages/core/src/memory/loader.ts` (`buildSystemPrompt`).
Ship-with: a `--strict-diagnosis` config flag if the extra prompt tokens are objectionable for simple sessions.

### 2. Verify-before-claim-done step

**Effort:** 1 day
**Why:** The single most damaging omission. Flash literally output "所有 34 项测试全部通过 ✅ 修改安全无破坏" without ever re-running `/skills` to see if find-skills actually loaded correctly.

Options in order of ambition:
- **a)** system-prompt only: "before saying 'done', re-run the command/scenario that surfaced the issue and paste the actual output. Do NOT paraphrase — quote."
- **b)** dedicated `verification-before-completion` built-in skill (always-on), same content as Anthropic's superpowers skill of that name, adapted to DEEPSEEK identity.
- **c)** hard rail: a `pre-completion` hook that requires the agent to run at least one Read/Bash after the final Edit before it can emit `done`.

Recommend a) + b) first. c) is a stretch.

### 3. Ship the 3 core process skills as always-on built-ins

**Effort:** 1–2 days
**Why:** These need to work **before** the skill loader itself is trustworthy, so they must be code-embedded, not markdown-loaded. Otherwise a broken skill layer masks the very rails that would have caught the break.

Skills to embed as `builtin-skills`:
- `systematic-debugging` — reproduce → hypotheses → test → minimal fix → verify. Blocks "observation → guess → edit" flow.
- `brainstorming` — enforces a design/agreement gate on non-trivial changes.
- `verification-before-completion` — see item 2.

Implementation notes:
- New module `packages/core/src/skills/builtin.ts` that returns hard-coded `Skill[]`.
- Merge into `SkillRegistry` at init before disk-loaded skills.
- User-level skills can override built-ins if same name (escape hatch).
- Trigger types: `systematic-debugging` = `auto` (keywords: bug, error, fails, wrong, broken); `brainstorming` = `auto` (keywords: implement, build, add, create new, refactor); `verification-before-completion` = `always`.

---

## P1 — Structural safety nets

### 4. Sensitive-path plan-mode gate

**Effort:** 1 day
**Why:** Edits to `packages/core/src/**/loader.ts`, `**/registry.ts`, `permission/**`, `skills/loader.ts`, `agent/loop.ts` are load-bearing. A first-attempt edit without a plan is the wrong default.

Design:
- Add to config: `sensitivePaths: string[]` (glob list), with sensible defaults.
- When agent proposes an Edit/Write matching a sensitive glob, permission engine returns "plan-mode required" — asks the user to `y` allow once / `p` force `/plan` this turn / `n` deny.
- Overridable session-wide with `/config sensitive off` for power users.

### 5. Reduce output over-confidence

**Effort:** small — prompt tweak + optional post-processor
**Why:** Beautiful headers + emojis make shallow reasoning look authoritative, which is worse than shallow reasoning that looks tentative. That's a UX problem, not a model problem.

- Prompt: "First-turn diagnoses and 'root cause' claims should read as hypotheses until verified. Reserve section headers (`##`, `🔴`, ✅) for post-verification summaries, not for initial analysis."
- Optional: a lightweight post-processor in `render/stream.ts` that dims/greys emoji-heavy blocks that appear before any tool call in the same turn (visual cue rather than censorship).

### 6. Default model routing (analysis vs action)

**Effort:** 2–3 days
**Why:** Flash is fine for triage / short answers / lookups. It's bad for diagnostic-heavy code work. Right now we pick one model per session; that's a false choice.

Design sketch:
- Config: `routing: { analysis: 'deepseek-v4-flash', action: 'deepseek-chat', deep: 'deepseek-reasoner' }`.
- Router lives at the top of `runTurn` — a cheap Flash call classifies the turn intent (`q&a | edit | debug | refactor`) and picks the runner model.
- Override with `/model` still respected.
- Kill-switch: `routing.enabled = false` → falls back to `config.model`.

Ship after item 3 (so debugging turns can be flagged for the strong model deterministically via skill trigger).

### 7. First-run project onboarding writes a starter DEEPSEEK.md

**Effort:** half a day
**Why:** Project-level DEEPSEEK.md is where "in THIS repo, format X is standard, not format Y" belongs. Nobody writes it from scratch.

- Extend `/init` (added in the slash-command overhaul) to also drop a starter DEEPSEEK.md if none exists.
- Template asks the user 3 questions on first REPL launch and fills them in:
  1. What language(s) is this repo?
  2. Any conventions the agent should never violate?
  3. Anything historically confusing about the codebase?
- Follow-up: `/memory learn` command that lets user say "remember that skills always use YAML frontmatter" and appends a well-formatted rule.

---

## P2 — Nice to have

### 8. `--dry-run` for edits on sensitive paths

Show the diff, prompt for approval, don't apply. Complements item 4.

### 9. Session forensics — `deepseek explain <session-id>`

Replays a session with annotations: "here you made an assumption without evidence", "here you claimed done without verification". Useful for the harness team to iterate on rails.

### 10. Autofix suggestions for user-installed skills

When we detect a skill file with HTML-comment metadata (`<!-- trigger: ... -->`) and no YAML frontmatter, offer to migrate it. Prevents drift for anyone who was using the old format.

### 11. Skill sanity checks on load

Warn on load if a skill has:
- No description
- `auto` trigger but no keywords
- `always` trigger with body > N tokens (bloats every turn)
- `command` trigger name colliding with a builtin

Print a summary line on REPL start: `skills: 7 loaded, 2 warnings — /skills doctor`.

### 12. Config schema + `/config validate`

Type-check `config.json` on load. Right now malformed config silently falls through.

---

## P3 — Tech Debt & Engineering

### 13. Sub-command routing refactor

**Effort:** 0.5 day
**Why:** Current `argv.includes('login')` pattern in main.ts will misfire if user input contains the word (e.g. `deepseek "fix login bug"`). Switch to proper commander `.command()` sub-commands.

### 14. Extract `runTurn` from main.ts closure

**Effort:** 0.5 day
**Why:** The 100-line closure captures 10+ outer variables, making it untestable in isolation. Extract to a standalone function with explicit deps.

### 15. Tools package unit tests

**Effort:** 1 day
**Why:** 8 tools with ZERO dedicated tests. Only verified indirectly via agent loop integration tests. Priority: bash (timeout/signal/env), edit (not-read guard), write (mkdir/overwrite).

### 16. Skill lint wired into startup

**Effort:** 1 hour
**Why:** `skills/lint.ts` exists but never called. Users get no feedback on malformed skills. Wire into REPL start: `skills: 7 loaded, 2 warnings — /skills doctor`.

### 17. VERSION single source of truth

**Effort:** 0.5 hour
**Why:** Version is hardcoded in `core/index.ts` ("0.3.0") AND `cli/main.ts` (.version("0.3.0")). Should read from package.json or a single const.

---

## P4 — UX Polish

### 18. Streaming token cost display

**Effort:** 0.5 day
**Why:** Users have no cost awareness during execution. Show `$0.003 (cache 82%)` in status bar, updated on each `usage` event.

### 19. `/doctor` self-diagnosis command

**Effort:** 0.5 day
**Why:** One command to check: config validity, API key reachability, rg installed, Node version, skills format, DEEPSEEK.md presence. Eliminates the "why doesn't it work" support loop.

### 20. Session improvements

**Effort:** 0.5 day
- `deepseek --last` to resume most recent session
- Auto-purge sessions older than 30 days
- `/sessions` shows first user message preview (already partial)

### 21. Incremental file index

**Effort:** 1 day
**Why:** `FileIndex.load()` synchronous full-scan blocks on large repos. Cache to `.deepseek-code/file-index.json`, incremental update via `git diff` on subsequent runs.

### 22. `--dry-run` for edits

**Effort:** 1 day
**Why:** Show diff + ask confirm without writing to disk. Complements sensitive-path gate (item 4) for extra safety.

---

## P5 — 对标 Claude Code 演进（v0.4 目标）

### 23. Headless / CI 模式

**Effort:** 1 day
**Why:** `claude -p "fix the bug"` 是 CI/CD 集成的基础。当前单次模式会弹权限确认，无法 pipe 使用。

- `deepseek --headless "prompt"` 或 `echo "prompt" | deepseek -p -`
- headless 模式下: 权限按 `--trust` 级别自动决策、输出纯文本、exit code 语义化
- `--trust none|tools|full`

### 24. 上下文窗口智能管理

**Effort:** 1 day
**Why:** Claude Code 在接近上下文上限时自动截断旧消息，用户无感。当前仅 80% 时触发 compact，且需额外 API 调用。

- 滑动窗口截断（不调模型，直接丢弃最旧 N 轮 + 插入截断标记）
- 工具输出超长（>8KB）自动截尾，保留头尾各 4KB
- 静默执行，不输出“正在压缩”提示

### 25. Git 工作流集成

**Effort:** 1.5 days
**Why:** Claude Code 有 `/commit`、自动 commit 建议、PR 生成。开发者日常最高频需求。

- `/commit` 命令: 基于 `git diff --staged` 生成 commit message，用户确认后执行
- `/pr` 命令: 基于当前分支 vs main 的 diff，生成 PR title + body，调用 `gh pr create`
- 自动提示: agent 执行结束后有文件变更时，状态栏闪现 "3 files changed — /commit?"

### 26. Sub-agent 并行框架

**Effort:** 2 days
**Why:** Claude Code 能派生子 agent 做并行搜索/分析。处理复杂任务的核心能力差距。

- 新工具 `Dispatch`: agent 可派生 1-3 个轻量子任务
- 子任务共享 readFiles 但独立 messages，使用 flash 模型
- 子任务只读（禁止 Edit/Write/Bash），防并发写冲突

### 27. REPL 实时成本显示

**Effort:** 0.5 day
**Why:** 用户无成本感知。每轮结束后状态栏显示 `tokens: 2,431 | $0.003 | cache: 78%`。

### 28. 长任务完成通知

**Effort:** 0.5 day
**Why:** Agent 执行超过 30s 时，完成时触发系统通知 + BEL 字符。可通过 `config.notifications = false` 关闭。

### 29. MultiEdit 工具（多文件批量编辑）

**Effort:** 1 day
**Why:** 当前 Edit 只能单文件单次。新工具接受 `{ edits: [{file, old, new}] }` 数组，原子性执行，失败回滚。

---

## Non-goals / rejected

- **Rewriting the agent loop to be "smarter"** — the bottleneck isn't the loop, it's the prompt + skills + verification rails around it.
- **Automatic model upgrade if Flash "seems confused"** — too heuristic, would misfire. Ship item 6 (deterministic routing) instead.
- **Enforcing plan mode globally** — kills the "one-liner tweak" flow that's a huge chunk of daily use. Sensitive-path gating (item 4) is the sweet spot.
- **图像/截图支持** — DeepSeek V4 API 当前不支持 vision，等模型侧就绪再接入。
- **文件监视/热重载** — ROI 不高，用户可通过 Bash 工具实现。
- **语义代码搜索** — ripgrep 已够用，向量索引引入额外依赖复杂度过高。

---

Last updated: 2026-07-01 · maintained by @Luna
