# Slash-Command Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 REPL 的 slash-command 体验全面对齐 Claude Code — 弹出菜单可 ↑↓ 选中、支持用户自定义命令、`@file` 引用、`#memory` 追加、模糊匹配、类别分组。

**Architecture:** 三层重写。Core 层新增 `commands/` 模块、`memory/appender`、`files/` 索引。CLI 层删除 `node:readline`，把输入行迁到 Ink（新增 `InputBox` / `SuggestionMenu` / `AgentStream` / `StatusBar`）。REPL 变成"单一持久 Ink 实例 + runTurn 驱动"。

**Tech Stack:** TypeScript · Ink 5 · React 18 · Vitest · fzy-lite（自写打分函数）· pnpm 9

## Global Constraints

- Node ≥ 20；pnpm workspace 三个 package 保留分层：`core` 不 import `cli`，工具走 registry
- 保留向后兼容：`/skills/<name>` 语法继续可用；已有内置命令 `/help /model /config /plan /clear /sessions /compact /quit /cancel` 全部保留
- 每个 task 结尾都要 commit；commit 消息用 `feat: ...` / `refactor: ...` / `test: ...` 前缀
- Vitest 集成到 `pnpm test`；新增文件必须有 unit test（UI 组件除外）
- Ink 版本 `^5.0.0`，不引入新依赖除非必要
- CJS/ESM：全项目 `"type": "module"`，import 用 `.js` 后缀（因为 `moduleResolution: node16`）
- 中文注释可保留，代码里 identifier 用英文
- 不改 CLI 参数、子命令、`--resume`、Session 磁盘格式

---

## File Structure

新增：

- `packages/core/src/commands/types.ts` — `Command`, `CommandTrigger`, `CommandSource`, `ParsedCommandFile`
- `packages/core/src/commands/parser.ts` — YAML frontmatter + body 解析、`$1/$ARGUMENTS` 展开
- `packages/core/src/commands/loader.ts` — 从磁盘加载 project + user commands
- `packages/core/src/commands/registry.ts` — 内置 + 加载的命令统一管理，冲突解决
- `packages/core/src/memory/appender.ts` — 追加 memory + 返回新 systemPrompt
- `packages/core/src/files/index.ts` — git-tracked + cwd 兜底的文件索引器
- `packages/core/src/fuzzy/score.ts` — fzy-lite 打分器（子序列 + 前缀奖励 + 命中区间）
- `packages/cli/src/ui/AgentStream.tsx` — 从 App.tsx 拆出的事件消费组件
- `packages/cli/src/ui/StatusBar.tsx` — 底部状态栏
- `packages/cli/src/ui/InputBox.tsx` — Ink 自绘输入行
- `packages/cli/src/ui/SuggestionMenu.tsx` — 弹出菜单
- `packages/cli/src/ui/MemoryScopePrompt.tsx` — `#memory` 追加时的选择框
- `packages/cli/src/ui/ConfirmPrompt.tsx` — `/clear` y/N 确认框
- `packages/cli/src/ui/hooks/useAgentStream.ts`
- `packages/cli/src/ui/hooks/useFuzzyMatch.ts`
- `packages/cli/src/ui/hooks/useLineEditor.ts` — 光标 / Ctrl+A/E/U/W 逻辑
- `packages/cli/src/router/index.ts` — Slash-command router（内置 + 用户 + skill）

修改：

- `packages/core/src/index.ts` — export 新模块
- `packages/cli/src/ui/App.tsx` — 重写为持久 shell
- `packages/cli/src/repl.ts` — 大幅精简；只负责 wiring
- `packages/cli/src/main.ts` — 删除 `/plan` 字符串嗅探（改走 router）

删除：

- `packages/cli/src/repl.ts` 里的 `SuggestionRenderer` 类、`createCompleter` 函数、所有手写 ANSI 逻辑

测试：

- `packages/core/src/commands/parser.test.ts`
- `packages/core/src/commands/loader.test.ts`
- `packages/core/src/commands/registry.test.ts`
- `packages/core/src/memory/appender.test.ts`
- `packages/core/src/files/index.test.ts`
- `packages/core/src/fuzzy/score.test.ts`
- `packages/cli/src/router/index.test.ts`

---

## Task 1: Fuzzy 打分器

**Files:**
- Create: `packages/core/src/fuzzy/score.ts`
- Test: `packages/core/src/fuzzy/score.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `score(query: string, target: string): { score: number; matches: number[] } | null` — null 表示不匹配；`matches` 是命中字符在 target 中的下标数组，用于高亮

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/fuzzy/score.test.ts
import { describe, it, expect } from 'vitest';
import { score } from './score.js';

describe('fuzzy score', () => {
  it('exact prefix beats subsequence', () => {
    const prefix = score('mod', 'model')!;
    const subseq = score('mod', 'summod')!;
    expect(prefix.score).toBeGreaterThan(subseq.score);
  });

  it('returns null when query chars missing', () => {
    expect(score('xyz', 'model')).toBeNull();
  });

  it('empty query matches everything with score 0', () => {
    const r = score('', 'anything')!;
    expect(r.score).toBe(0);
    expect(r.matches).toEqual([]);
  });

  it('captures match indices for highlighting', () => {
    const r = score('me', 'memory')!;
    expect(r.matches).toEqual([0, 1]);
  });

  it('is case-insensitive', () => {
    expect(score('Mo', 'model')).not.toBeNull();
    expect(score('MO', 'model')).not.toBeNull();
  });

  it('consecutive matches score higher than scattered', () => {
    const cons = score('ab', 'abcxyz')!;
    const scat = score('ab', 'axbxyz')!;
    expect(cons.score).toBeGreaterThan(scat.score);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/fuzzy/score.test.ts`
Expected: FAIL — module `./score.js` not found

- [ ] **Step 3: Implement minimal fuzzy scorer**

```ts
// packages/core/src/fuzzy/score.ts
/**
 * fzy-lite 打分器：
 * - 子序列匹配（不连续也可）
 * - 前缀命中奖励
 * - 连续命中奖励
 * - 单词开头（分隔符 or 大小写切换）奖励
 * 返回 null 表示不匹配。
 */
export interface FuzzyResult {
  score: number;
  matches: number[];
}

const BONUS_PREFIX = 4;
const BONUS_CONSECUTIVE = 2;
const BONUS_WORD_START = 1.5;
const PENALTY_GAP = -0.05;

export function score(query: string, target: string): FuzzyResult | null {
  if (query.length === 0) return { score: 0, matches: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const matches: number[] = [];
  let qi = 0;
  let sc = 0;
  let lastMatch = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);
      if (ti === 0 && qi === 0) sc += BONUS_PREFIX;
      if (lastMatch === ti - 1) sc += BONUS_CONSECUTIVE;
      const prev = target[ti - 1];
      const isWordStart = ti === 0 || prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ';
      if (isWordStart) sc += BONUS_WORD_START;
      sc += PENALTY_GAP * (ti - lastMatch - 1);
      lastMatch = ti;
      qi++;
    }
  }

  if (qi < q.length) return null;
  return { score: sc, matches };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/fuzzy/score.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Export from core index**

Modify `packages/core/src/index.ts` — append:
```ts
export * from './fuzzy/score.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/fuzzy/ packages/core/src/index.ts
git -c commit.gpgsign=false commit -m "feat(core): add fuzzy scorer for command/file suggestions"
```

---

## Task 2: Command 类型 & Parser

**Files:**
- Create: `packages/core/src/commands/types.ts`, `packages/core/src/commands/parser.ts`
- Test: `packages/core/src/commands/parser.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface Command { name: string; description: string; argumentHint?: string; allowedTools?: string[]; model?: string; body: string; source: CommandSource; filePath?: string }`
  - `type CommandSource = 'builtin' | 'project' | 'user' | 'skill'`
  - `parseCommandFile(raw: string, filePath: string, source: 'project' | 'user'): Command | null`
  - `expandArguments(body: string, args: string): string` — 替换 `$1`, `$2`, `$ARGUMENTS`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/commands/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseCommandFile, expandArguments } from './parser.js';

describe('parseCommandFile', () => {
  it('parses full frontmatter', () => {
    const raw = `---
description: Create PR
argument-hint: <base>
allowed-tools: [Bash, Read]
model: deepseek-chat
---
body $1 $ARGUMENTS`;
    const cmd = parseCommandFile(raw, '/x/pr.md', 'project')!;
    expect(cmd.name).toBe('pr');
    expect(cmd.description).toBe('Create PR');
    expect(cmd.argumentHint).toBe('<base>');
    expect(cmd.allowedTools).toEqual(['Bash', 'Read']);
    expect(cmd.model).toBe('deepseek-chat');
    expect(cmd.body).toBe('body $1 $ARGUMENTS');
    expect(cmd.source).toBe('project');
  });

  it('falls back to first non-empty line as description', () => {
    const raw = `Do the thing.\nMore detail.`;
    const cmd = parseCommandFile(raw, '/x/foo.md', 'user')!;
    expect(cmd.description).toBe('Do the thing.');
    expect(cmd.name).toBe('foo');
  });

  it('name derived from subdir → colon namespace', () => {
    const cmd = parseCommandFile('body', '/root/git/pr.md', 'project', '/root')!;
    expect(cmd.name).toBe('git:pr');
  });

  it('returns null on empty body', () => {
    expect(parseCommandFile('---\ndescription: x\n---\n\n', '/x/e.md', 'user')).toBeNull();
  });
});

describe('expandArguments', () => {
  it('replaces $1 $2 $ARGUMENTS', () => {
    expect(expandArguments('a $1 b $2 c $ARGUMENTS d', 'x y z')).toBe('a x b y c x y z d');
  });

  it('keeps literal when arg missing', () => {
    expect(expandArguments('a $1 b', '')).toBe('a $1 b');
  });

  it('handles $ARGUMENTS alone', () => {
    expect(expandArguments('$ARGUMENTS', 'hello world')).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/commands/parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement types**

```ts
// packages/core/src/commands/types.ts
export type CommandSource = 'builtin' | 'project' | 'user' | 'skill';

export interface Command {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  /** body 用于展开为 user turn；builtin/skill 命令可为空并用 handler 处理 */
  body: string;
  source: CommandSource;
  filePath?: string;
}
```

- [ ] **Step 4: Implement parser**

```ts
// packages/core/src/commands/parser.ts
import { basename, relative, dirname } from 'node:path';
import type { Command, CommandSource } from './types.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * 解析 YAML frontmatter（子集：仅支持 key: value 与 [a, b] 数组）
 * 完整 YAML 会引入依赖，这里只做最小实现
 */
function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    const trimmed = val.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      out[key] = trimmed.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      out[key] = trimmed;
    }
  }
  return out;
}

/**
 * 解析命令文件为 Command 对象
 * @param raw 文件原始内容
 * @param filePath 绝对路径（用于生成 name）
 * @param source 'project' | 'user'
 * @param baseDir 命令根目录（用于子目录 → 冒号命名空间）
 */
export function parseCommandFile(
  raw: string,
  filePath: string,
  source: 'project' | 'user',
  baseDir?: string,
): Command | null {
  let body = raw;
  let fm: Record<string, string | string[]> = {};
  const m = raw.match(FRONTMATTER_RE);
  if (m) {
    fm = parseFrontmatter(m[1]);
    body = raw.slice(m[0].length);
  }
  body = body.trim();
  if (!body) return null;

  // name: 子目录 → 冒号
  const fileBase = basename(filePath, '.md');
  let name = fileBase;
  if (baseDir) {
    const relDir = relative(baseDir, dirname(filePath));
    if (relDir && relDir !== '.') {
      name = `${relDir.split('/').join(':')}:${fileBase}`;
    }
  }

  const description = typeof fm.description === 'string'
    ? fm.description
    : body.split('\n').find(l => l.trim().length > 0)?.trim() ?? name;

  return {
    name,
    description,
    argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined,
    allowedTools: Array.isArray(fm['allowed-tools']) ? fm['allowed-tools'] as string[] : undefined,
    model: typeof fm.model === 'string' ? fm.model : undefined,
    body,
    source,
    filePath,
  };
}

/** 展开 $1 $2 $ARGUMENTS 占位符 */
export function expandArguments(body: string, args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  let out = body.replace(/\$ARGUMENTS\b/g, args);
  out = out.replace(/\$(\d+)\b/g, (m, n) => {
    const idx = parseInt(n, 10) - 1;
    return parts[idx] ?? m;
  });
  return out;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/commands/parser.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/commands/
git -c commit.gpgsign=false commit -m "feat(core): add command file parser with frontmatter and arg expansion"
```

---

## Task 3: Command Loader

**Files:**
- Create: `packages/core/src/commands/loader.ts`
- Test: `packages/core/src/commands/loader.test.ts`

**Interfaces:**
- Consumes: `parseCommandFile` from Task 2
- Produces: `loadCommands(opts: { cwd: string; homeDir?: string }): Command[]` — 递归 `~/.deepseek-code/commands/` 和 `<cwd>/.deepseek-code/commands/`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/commands/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCommands } from './loader.js';

const TMP = join(tmpdir(), 'deepseek-code-cmd-test');

describe('loadCommands', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'home/.deepseek-code/commands'), { recursive: true });
    mkdirSync(join(TMP, 'proj/.deepseek-code/commands/git'), { recursive: true });
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('loads project + user commands, project overrides user on name conflict', () => {
    writeFileSync(join(TMP, 'home/.deepseek-code/commands/pr.md'), 'user pr');
    writeFileSync(join(TMP, 'home/.deepseek-code/commands/hello.md'), 'user hello');
    writeFileSync(join(TMP, 'proj/.deepseek-code/commands/pr.md'), 'project pr');
    writeFileSync(join(TMP, 'proj/.deepseek-code/commands/git/pr.md'), 'gitpr');

    const cmds = loadCommands({ cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home') });
    const byName = Object.fromEntries(cmds.map(c => [c.name, c]));

    expect(byName.pr.source).toBe('project');
    expect(byName.pr.body).toBe('project pr');
    expect(byName.hello.source).toBe('user');
    expect(byName['git:pr'].body).toBe('gitpr');
    expect(byName['git:pr'].source).toBe('project');
  });

  it('returns empty array when no directories exist', () => {
    const cmds = loadCommands({ cwd: join(TMP, 'nowhere'), homeDir: join(TMP, 'nowhere2') });
    expect(cmds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/commands/loader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement loader**

```ts
// packages/core/src/commands/loader.ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from './types.js';
import { parseCommandFile } from './parser.js';

export interface LoadCommandsOpts {
  cwd: string;
  homeDir?: string;
}

export function loadCommands(opts: LoadCommandsOpts): Command[] {
  const home = opts.homeDir ?? homedir();
  const out = new Map<string, Command>();

  // user first
  const userDir = join(home, '.deepseek-code', 'commands');
  loadFromDir(userDir, userDir, 'user', out);

  // project last (overrides)
  const projectDir = join(opts.cwd, '.deepseek-code', 'commands');
  loadFromDir(projectDir, projectDir, 'project', out);

  return [...out.values()];
}

function loadFromDir(dir: string, baseDir: string, source: 'project' | 'user', out: Map<string, Command>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      loadFromDir(full, baseDir, source, out);
      continue;
    }
    if (!entry.endsWith('.md')) continue;
    let raw;
    try { raw = readFileSync(full, 'utf8'); } catch { continue; }
    const cmd = parseCommandFile(raw, full, source, baseDir);
    if (cmd) out.set(cmd.name, cmd);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/commands/loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/commands/loader.ts packages/core/src/commands/loader.test.ts
git -c commit.gpgsign=false commit -m "feat(core): add command loader with project-overrides-user semantics"
```

---

## Task 4: Command Registry

**Files:**
- Create: `packages/core/src/commands/registry.ts`
- Test: `packages/core/src/commands/registry.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Command`, `loadCommands` from Tasks 2-3
- Produces:
  ```ts
  class CommandRegistry {
    registerBuiltin(cmd: Command): void
    loadFromDisk(opts: { cwd: string; homeDir?: string }): void
    ingestSkillCommands(skills: { name: string; description: string; content: string; trigger: { type: string; name?: string } }[]): void
    resolve(name: string): Command | undefined
    list(): Command[]  // sorted: builtin > project > user > skill
    filter(query: string): Array<{ cmd: Command; matches: number[]; score: number }>
  }
  ```

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/commands/registry.test.ts
import { describe, it, expect } from 'vitest';
import { CommandRegistry } from './registry.js';
import type { Command } from './types.js';

const mk = (name: string, source: Command['source'], desc = ''): Command => ({
  name, description: desc, body: 'x', source,
});

describe('CommandRegistry', () => {
  it('resolves in priority order: builtin > project > user > skill', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('help', 'builtin', 'B'));
    r.ingestSkillCommands([{ name: 'help', description: 'S', content: 'x', trigger: { type: 'command', name: 'help' } }]);
    // simulate loader result via ingest project
    (r as any).addForTest?.(mk('help', 'project', 'P'));
    // Since no addForTest, test resolve of builtin still wins:
    expect(r.resolve('help')!.source).toBe('builtin');
  });

  it('filter uses fuzzy match, empty query returns all sorted by priority then name', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('help', 'builtin'));
    r.registerBuiltin(mk('model', 'builtin'));
    const all = r.filter('');
    expect(all.map(x => x.cmd.name)).toEqual(['help', 'model']);
  });

  it('filter ranks by fuzzy score', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('memory', 'builtin'));
    r.registerBuiltin(mk('model', 'builtin'));
    r.registerBuiltin(mk('mcp', 'builtin'));
    const filtered = r.filter('mo');
    // 'mo' matches 'model' (prefix, score highest) and 'memory' (subseq)
    expect(filtered[0].cmd.name).toBe('model');
    expect(filtered.map(x => x.cmd.name)).toContain('memory');
    expect(filtered.map(x => x.cmd.name)).not.toContain('mcp');
  });

  it('skill commands do not override builtin', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('clear', 'builtin', 'BI'));
    r.ingestSkillCommands([{ name: 'clear', description: 'S', content: 'x', trigger: { type: 'command', name: 'clear' } }]);
    expect(r.resolve('clear')!.description).toBe('BI');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/commands/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement registry**

```ts
// packages/core/src/commands/registry.ts
import type { Command } from './types.js';
import { loadCommands, type LoadCommandsOpts } from './loader.js';
import { score } from '../fuzzy/score.js';

const PRIORITY: Record<Command['source'], number> = {
  builtin: 0, project: 1, user: 2, skill: 3,
};

export interface FilteredCommand {
  cmd: Command;
  matches: number[];
  score: number;
}

export class CommandRegistry {
  private byName = new Map<string, Command>();

  registerBuiltin(cmd: Command): void {
    this.byName.set(cmd.name, { ...cmd, source: 'builtin' });
  }

  loadFromDisk(opts: LoadCommandsOpts): void {
    for (const c of loadCommands(opts)) {
      const existing = this.byName.get(c.name);
      if (!existing || PRIORITY[c.source] < PRIORITY[existing.source]) {
        this.byName.set(c.name, c);
      }
    }
  }

  ingestSkillCommands(skills: Array<{ name: string; description: string; content: string; trigger: { type: string; name?: string } }>): void {
    for (const s of skills) {
      if (s.trigger.type !== 'command') continue;
      const cmdName = s.trigger.name ?? s.name;
      if (this.byName.has(cmdName)) continue; // lower priority; do not override
      this.byName.set(cmdName, {
        name: cmdName,
        description: s.description,
        body: s.content,
        source: 'skill',
      });
    }
  }

  resolve(name: string): Command | undefined {
    return this.byName.get(name);
  }

  list(): Command[] {
    return [...this.byName.values()].sort((a, b) => {
      const p = PRIORITY[a.source] - PRIORITY[b.source];
      return p !== 0 ? p : a.name.localeCompare(b.name);
    });
  }

  filter(query: string): FilteredCommand[] {
    if (!query) return this.list().map(cmd => ({ cmd, matches: [], score: 0 }));
    const results: FilteredCommand[] = [];
    for (const cmd of this.byName.values()) {
      const r = score(query, cmd.name);
      if (!r) continue;
      results.push({ cmd, matches: r.matches, score: r.score });
    }
    return results.sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name));
  }
}
```

- [ ] **Step 4: Remove obsolete `addForTest` reference in test**

The test above references a hypothetical `addForTest`. Rewrite that test case simpler:

```ts
// replace the "resolves in priority order" test with:
it('project-loaded overrides user-loaded via loader logic', () => {
  const r = new CommandRegistry();
  // simulate by direct set with proper source
  (r as any).byName.set('pr', mk('pr', 'user', 'U'));
  const cmd: Command = { name: 'pr', description: 'P', body: 'x', source: 'project' };
  // priority: project (1) < user (2), so should replace
  if (PRIORITY_LOWER(cmd.source, (r as any).byName.get('pr').source)) {
    (r as any).byName.set('pr', cmd);
  }
  expect(r.resolve('pr')!.source).toBe('project');
});

function PRIORITY_LOWER(a: Command['source'], b: Command['source']): boolean {
  const p = { builtin: 0, project: 1, user: 2, skill: 3 };
  return p[a] < p[b];
}
```

Better: replace that entire test with the deterministic behavior we actually expose:

```ts
it('registerBuiltin wins over ingestSkillCommands with same name', () => {
  const r = new CommandRegistry();
  r.registerBuiltin(mk('help', 'builtin', 'B'));
  r.ingestSkillCommands([{ name: 'help', description: 'S', content: 'x', trigger: { type: 'command', name: 'help' } }]);
  expect(r.resolve('help')!.source).toBe('builtin');
  expect(r.resolve('help')!.description).toBe('B');
});
```

Update `registry.test.ts` accordingly before running.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/commands/registry.test.ts`
Expected: PASS

- [ ] **Step 6: Export from core index**

Modify `packages/core/src/index.ts` — append:
```ts
export * from './commands/types.js';
export * from './commands/parser.js';
export * from './commands/loader.js';
export * from './commands/registry.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/commands/registry.ts packages/core/src/commands/registry.test.ts packages/core/src/index.ts
git -c commit.gpgsign=false commit -m "feat(core): add CommandRegistry with priority routing and fuzzy filter"
```

---

## Task 5: Memory Appender

**Files:**
- Create: `packages/core/src/memory/appender.ts`
- Test: `packages/core/src/memory/appender.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `appendMemory(opts: { scope: 'project' | 'user'; text: string; cwd: string; homeDir?: string }): { filePath: string; created: boolean }`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/memory/appender.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMemory } from './appender.js';

const TMP = join(tmpdir(), 'ds-mem-test');

describe('appendMemory', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'home/.deepseek-code'), { recursive: true });
    mkdirSync(join(TMP, 'proj'), { recursive: true });
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('creates project DEEPSEEK.md if missing', () => {
    const r = appendMemory({ scope: 'project', text: 'no mocks', cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home') });
    expect(r.created).toBe(true);
    expect(existsSync(r.filePath)).toBe(true);
    expect(readFileSync(r.filePath, 'utf8')).toContain('no mocks');
  });

  it('appends to existing project file', () => {
    const p = join(TMP, 'proj/DEEPSEEK.md');
    writeFileSync(p, '# Existing\n\n- rule 1\n');
    const r = appendMemory({ scope: 'project', text: 'rule 2', cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home') });
    expect(r.created).toBe(false);
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('rule 1');
    expect(content).toContain('rule 2');
  });

  it('user scope writes to homeDir', () => {
    const r = appendMemory({ scope: 'user', text: 'global', cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home') });
    expect(r.filePath).toBe(join(TMP, 'home/.deepseek-code/DEEPSEEK.md'));
    expect(readFileSync(r.filePath, 'utf8')).toContain('global');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/memory/appender.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement appender**

```ts
// packages/core/src/memory/appender.ts
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface AppendMemoryOpts {
  scope: 'project' | 'user';
  text: string;
  cwd: string;
  homeDir?: string;
}

export interface AppendMemoryResult {
  filePath: string;
  created: boolean;
}

export function appendMemory(opts: AppendMemoryOpts): AppendMemoryResult {
  const home = opts.homeDir ?? homedir();
  const filePath = opts.scope === 'user'
    ? join(home, '.deepseek-code', 'DEEPSEEK.md')
    : join(opts.cwd, 'DEEPSEEK.md');

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const line = `- ${opts.text.trim()}\n`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# Memory\n\n${line}`);
    return { filePath, created: true };
  }
  appendFileSync(filePath, line);
  return { filePath, created: false };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/memory/appender.test.ts`
Expected: PASS

- [ ] **Step 5: Export from core index**

Append to `packages/core/src/index.ts`:
```ts
export * from './memory/appender.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/memory/appender.ts packages/core/src/memory/appender.test.ts packages/core/src/index.ts
git -c commit.gpgsign=false commit -m "feat(core): appendMemory API for #memory shortcut"
```

---

## Task 6: File Index

**Files:**
- Create: `packages/core/src/files/index.ts`
- Test: `packages/core/src/files/index.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  class FileIndex {
    constructor(opts: { cwd: string })
    load(): void  // sync scan
    all(): string[]  // relative paths, cached
    search(query: string, limit?: number): Array<{ path: string; matches: number[]; score: number }>
  }
  ```

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/files/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileIndex } from './index.js';

const TMP = join(tmpdir(), 'ds-fileindex-test');

describe('FileIndex (no git)', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'src'), { recursive: true });
    mkdirSync(join(TMP, 'node_modules/foo'), { recursive: true });
    writeFileSync(join(TMP, 'src/a.ts'), 'x');
    writeFileSync(join(TMP, 'src/b.ts'), 'x');
    writeFileSync(join(TMP, 'node_modules/foo/x.js'), 'x');
    writeFileSync(join(TMP, 'README.md'), 'x');
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('scans cwd but skips node_modules', () => {
    const idx = new FileIndex({ cwd: TMP });
    idx.load();
    const all = idx.all();
    expect(all).toContain('src/a.ts');
    expect(all).toContain('README.md');
    expect(all.some(p => p.includes('node_modules'))).toBe(false);
  });

  it('search returns fuzzy matches sorted by score', () => {
    const idx = new FileIndex({ cwd: TMP });
    idx.load();
    const hits = idx.search('at', 5);
    // 'src/a.ts' contains 'a' + '.ts' with 't' — subseq match
    expect(hits.some(h => h.path === 'src/a.ts')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/files/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FileIndex**

```ts
// packages/core/src/files/index.ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { score } from '../fuzzy/score.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '.cache', '.git']);

export interface FileIndexOpts {
  cwd: string;
}

export class FileIndex {
  private paths: string[] = [];
  constructor(private opts: FileIndexOpts) {}

  load(): void {
    if (existsSync(join(this.opts.cwd, '.git'))) {
      try {
        const out = execSync('git ls-files --cached --others --exclude-standard', {
          cwd: this.opts.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        });
        this.paths = out.split('\n').filter(Boolean);
        return;
      } catch {
        // fall through to fs scan
      }
    }
    this.paths = [];
    this.walk(this.opts.cwd);
  }

  private walk(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e)) continue;
      if (e.startsWith('.') && e !== '.deepseek-code') continue;
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        this.walk(full);
      } else if (st.isFile()) {
        this.paths.push(relative(this.opts.cwd, full));
      }
    }
  }

  all(): string[] {
    return this.paths;
  }

  search(query: string, limit = 30): Array<{ path: string; matches: number[]; score: number }> {
    if (!query) return this.paths.slice(0, limit).map(p => ({ path: p, matches: [], score: 0 }));
    const results: Array<{ path: string; matches: number[]; score: number }> = [];
    for (const p of this.paths) {
      const r = score(query, p);
      if (!r) continue;
      results.push({ path: p, matches: r.matches, score: r.score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deepseek-code/core exec vitest run src/files/index.test.ts`
Expected: PASS

- [ ] **Step 5: Export from core index**

Append to `packages/core/src/index.ts`:
```ts
export * from './files/index.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/files/ packages/core/src/index.ts
git -c commit.gpgsign=false commit -m "feat(core): FileIndex with git-tracked + cwd fallback and fuzzy search"
```

---

## Task 7: Slash Router

**Files:**
- Create: `packages/cli/src/router/index.ts`
- Test: `packages/cli/src/router/index.test.ts`

**Interfaces:**
- Consumes: `CommandRegistry`, `Command`, `expandArguments` from core
- Produces:
  ```ts
  type RouterAction =
    | { kind: 'builtin'; name: string; args: string }
    | { kind: 'agent'; prompt: string; allowedTools?: string[]; modelOverride?: string }
    | { kind: 'unknown'; name: string }
    | { kind: 'passthrough'; text: string }
  function routeInput(input: string, registry: CommandRegistry): RouterAction
  ```

- [ ] **Step 1: Write failing test**

```ts
// packages/cli/src/router/index.test.ts
import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '@deepseek-code/core';
import { routeInput } from './index.js';

function mkReg() {
  const r = new CommandRegistry();
  r.registerBuiltin({ name: 'help', description: 'H', body: '', source: 'builtin' });
  r.registerBuiltin({ name: 'plan', description: 'P', body: '', source: 'builtin' });
  (r as any).byName.set('pr', {
    name: 'pr', description: 'PR', body: 'do PR $1 $ARGUMENTS',
    source: 'project', allowedTools: ['Bash'], model: 'deepseek-chat',
  });
  return r;
}

describe('routeInput', () => {
  it('routes plain text to passthrough', () => {
    const r = routeInput('hello world', mkReg());
    expect(r).toEqual({ kind: 'passthrough', text: 'hello world' });
  });

  it('routes /help to builtin', () => {
    const r = routeInput('/help', mkReg());
    expect(r).toEqual({ kind: 'builtin', name: 'help', args: '' });
  });

  it('routes /plan with args to builtin', () => {
    const r = routeInput('/plan refactor auth', mkReg());
    expect(r).toEqual({ kind: 'builtin', name: 'plan', args: 'refactor auth' });
  });

  it('routes user command to agent with expanded body + overrides', () => {
    const r = routeInput('/pr main extra info', mkReg());
    expect(r.kind).toBe('agent');
    if (r.kind === 'agent') {
      expect(r.prompt).toBe('do PR main main extra info');
      expect(r.allowedTools).toEqual(['Bash']);
      expect(r.modelOverride).toBe('deepseek-chat');
    }
  });

  it('unknown slash returns unknown', () => {
    const r = routeInput('/nope', mkReg());
    expect(r).toEqual({ kind: 'unknown', name: 'nope' });
  });

  it('supports /skills/<name> passthrough form', () => {
    // /skills/xxx does not exist as command; treat as unknown so REPL can handle
    // (we keep legacy path in REPL handler)
    const r = routeInput('/skills/foo bar', mkReg());
    expect(r.kind).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter deepseek-code exec vitest run src/router/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement router**

```ts
// packages/cli/src/router/index.ts
import type { CommandRegistry } from '@deepseek-code/core';
import { expandArguments } from '@deepseek-code/core';

export type RouterAction =
  | { kind: 'builtin'; name: string; args: string }
  | { kind: 'agent'; prompt: string; allowedTools?: string[]; modelOverride?: string }
  | { kind: 'unknown'; name: string }
  | { kind: 'passthrough'; text: string };

export function routeInput(input: string, registry: CommandRegistry): RouterAction {
  if (!input.startsWith('/')) {
    return { kind: 'passthrough', text: input };
  }
  const stripped = input.slice(1);
  const spaceIdx = stripped.indexOf(' ');
  const name = spaceIdx === -1 ? stripped : stripped.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : stripped.slice(spaceIdx + 1);

  const cmd = registry.resolve(name);
  if (!cmd) return { kind: 'unknown', name };

  if (cmd.source === 'builtin') {
    return { kind: 'builtin', name: cmd.name, args };
  }

  const prompt = expandArguments(cmd.body, args);
  return {
    kind: 'agent',
    prompt,
    allowedTools: cmd.allowedTools,
    modelOverride: cmd.model,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter deepseek-code exec vitest run src/router/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/router/
git -c commit.gpgsign=false commit -m "feat(cli): slash-command router with builtin/agent dispatch"
```

---

## Task 8: Split AgentStream from App

**Files:**
- Create: `packages/cli/src/ui/AgentStream.tsx`, `packages/cli/src/ui/hooks/useAgentStream.ts`
- Modify: `packages/cli/src/ui/App.tsx` (keep temporarily working)

**Interfaces:**
- Produces:
  ```ts
  interface UseAgentStreamState { messages: UIMessage[]; streaming: string; thinking: string; isRunning: boolean }
  function useAgentStream(events: AsyncIterable<AgentEvent> | null): UseAgentStreamState
  function AgentStream(props: { state: UseAgentStreamState }): ReactNode
  ```

- [ ] **Step 1: Write hook**

Create `packages/cli/src/ui/hooks/useAgentStream.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import type { AgentEvent, ToolResultEnvelope } from '@deepseek-code/core';

export interface UIMessage {
  type: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResultEnvelope;
}

export interface UseAgentStreamState {
  messages: UIMessage[];
  streaming: string;
  thinking: string;
  isRunning: boolean;
  exitCode: number;
}

export function useAgentStream(events: AsyncIterable<AgentEvent> | null): UseAgentStreamState {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [thinking, setThinking] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [exitCode, setExitCode] = useState(0);
  const iterRef = useRef<AsyncIterable<AgentEvent> | null>(null);

  useEffect(() => {
    if (!events || iterRef.current === events) return;
    iterRef.current = events;
    setIsRunning(true);
    setStreaming('');
    setThinking('');

    let cancelled = false;
    (async () => {
      let ec = 0;
      for await (const ev of events) {
        if (cancelled) break;
        switch (ev.type) {
          case 'text_delta':
            setStreaming(prev => prev + ev.text);
            break;
          case 'thinking_delta':
            setThinking(prev => prev + ev.text);
            break;
          case 'tool_call_start':
            setStreaming(prev => {
              if (prev) setMessages(m => [...m, { type: 'assistant', content: prev }]);
              return '';
            });
            setThinking('');
            setMessages(m => [...m, { type: 'tool', content: '', toolName: ev.name, toolInput: ev.input }]);
            break;
          case 'tool_call_result':
            setMessages(m => {
              const u = [...m];
              for (let i = u.length - 1; i >= 0; i--) {
                if (u[i].type === 'tool' && !u[i].toolResult) {
                  u[i] = { ...u[i], toolResult: ev.result };
                  break;
                }
              }
              return u;
            });
            break;
          case 'error':
            setMessages(m => [...m, { type: 'error', content: `${ev.error.code}: ${ev.error.userMessage}` }]);
            break;
          case 'done':
            setStreaming(prev => {
              if (prev) setMessages(m => [...m, { type: 'assistant', content: prev }]);
              return '';
            });
            setThinking('');
            setIsRunning(false);
            if (ev.reason === 'fatal' || ev.reason === 'max_steps') ec = 1;
            if (ev.reason === 'abort') ec = 130;
            break;
        }
      }
      setExitCode(ec);
    })();

    return () => { cancelled = true; };
  }, [events]);

  return { messages, streaming, thinking, isRunning, exitCode };
}
```

- [ ] **Step 2: Write AgentStream component**

Create `packages/cli/src/ui/AgentStream.tsx`:

```tsx
import React from 'react';
import { Box, Text, Static } from 'ink';
import Spinner from 'ink-spinner';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { UseAgentStreamState, UIMessage } from './hooks/useAgentStream.js';
import type { ToolResultEnvelope } from '@deepseek-code/core';

const marked = new Marked(markedTerminal() as any);
function renderMarkdown(md: string): string {
  try { return (marked.parse(md) as string).trimEnd(); } catch { return md; }
}

function ToolPanel({ name, input, result }: { name: string; input: unknown; result?: ToolResultEnvelope }) {
  const shortInput = typeof input === 'object' && input
    ? (input as any).file_path ?? (input as any).command?.slice(0, 60) ?? (input as any).pattern ?? JSON.stringify(input).slice(0, 60)
    : String(input).slice(0, 60);
  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text color="cyan">▶ {name}({shortInput})</Text>
      {result && (result.ok ? <Text color="green">  ✓ OK</Text> : <Text color="red">  ✗ {result.error}</Text>)}
    </Box>
  );
}

function MessageView({ msg }: { msg: UIMessage }) {
  switch (msg.type) {
    case 'user':
      return <Text color="green">┃ You: {msg.content}</Text>;
    case 'assistant':
      return <Text>{renderMarkdown(msg.content)}</Text>;
    case 'tool':
      return <ToolPanel name={msg.toolName!} input={msg.toolInput} result={msg.toolResult} />;
    case 'error':
      return <Text color="red">! {msg.content}</Text>;
    default:
      return null;
  }
}

export function AgentStream({ state }: { state: UseAgentStreamState }) {
  const { messages, streaming, thinking, isRunning } = state;
  return (
    <Box flexDirection="column">
      <Static items={messages.map((m, i) => ({ ...m, __i: i }))}>
        {(m) => <MessageView key={m.__i} msg={m} />}
      </Static>
      {thinking && (
        <Box>
          <Text color="gray"><Spinner type="dots" /> {thinking.slice(-120)}</Text>
        </Box>
      )}
      {streaming && <Text>{renderMarkdown(streaming)}</Text>}
      {isRunning && !streaming && !thinking && (
        <Box><Text color="gray"><Spinner type="dots" /> 等待响应...</Text></Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Verify types check**

Run: `pnpm --filter deepseek-code exec tsc -p tsconfig.json --noEmit`
Expected: no new errors (existing App.tsx still works)

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/ui/AgentStream.tsx packages/cli/src/ui/hooks/
git -c commit.gpgsign=false commit -m "refactor(cli): extract AgentStream component and useAgentStream hook"
```

---

## Task 9: Line Editor Hook

**Files:**
- Create: `packages/cli/src/ui/hooks/useLineEditor.ts`
- Test: `packages/cli/src/ui/hooks/useLineEditor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface LineState { value: string; cursor: number }
  interface LineAPI { state: LineState; onKey(input: string, key: KeyInfo): 'submit' | 'consumed' | 'passthrough'; setValue(v: string, cursor?: number): void; reset(): void }
  function useLineEditor(): LineAPI
  ```

- [ ] **Step 1: Write failing test**

```ts
// packages/cli/src/ui/hooks/useLineEditor.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLineEditor } from './useLineEditor.js';

describe('useLineEditor', () => {
  it('appends chars and moves cursor', () => {
    const { result } = renderHook(() => useLineEditor());
    act(() => { result.current.onKey('h', {}); });
    act(() => { result.current.onKey('i', {}); });
    expect(result.current.state.value).toBe('hi');
    expect(result.current.state.cursor).toBe(2);
  });

  it('backspace removes previous char', () => {
    const { result } = renderHook(() => useLineEditor());
    act(() => { result.current.onKey('a', {}); result.current.onKey('b', {}); });
    act(() => { result.current.onKey('', { backspace: true }); });
    expect(result.current.state.value).toBe('a');
    expect(result.current.state.cursor).toBe(1);
  });

  it('Ctrl+A moves to line start, Ctrl+E to end', () => {
    const { result } = renderHook(() => useLineEditor());
    act(() => { result.current.setValue('hello', 5); });
    act(() => { result.current.onKey('', { ctrl: true, name: 'a' }); });
    expect(result.current.state.cursor).toBe(0);
    act(() => { result.current.onKey('', { ctrl: true, name: 'e' }); });
    expect(result.current.state.cursor).toBe(5);
  });

  it('Ctrl+U deletes to line start', () => {
    const { result } = renderHook(() => useLineEditor());
    act(() => { result.current.setValue('hello', 3); });
    act(() => { result.current.onKey('', { ctrl: true, name: 'u' }); });
    expect(result.current.state.value).toBe('lo');
    expect(result.current.state.cursor).toBe(0);
  });

  it('Enter returns submit', () => {
    const { result } = renderHook(() => useLineEditor());
    act(() => { result.current.setValue('go', 2); });
    let outcome: string | undefined;
    act(() => { outcome = result.current.onKey('', { return: true }); });
    expect(outcome).toBe('submit');
  });
});
```

Add dev dep if missing:

```bash
pnpm --filter deepseek-code add -D @testing-library/react
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter deepseek-code exec vitest run src/ui/hooks/useLineEditor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement hook**

```ts
// packages/cli/src/ui/hooks/useLineEditor.ts
import { useState, useCallback } from 'react';

export interface KeyInfo {
  ctrl?: boolean;
  meta?: boolean;
  backspace?: boolean;
  delete?: boolean;
  return?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  name?: string;
}

export interface LineState { value: string; cursor: number }

export interface LineAPI {
  state: LineState;
  onKey(input: string, key: KeyInfo): 'submit' | 'consumed' | 'passthrough';
  setValue(v: string, cursor?: number): void;
  reset(): void;
}

export function useLineEditor(): LineAPI {
  const [state, setState] = useState<LineState>({ value: '', cursor: 0 });

  const setValue = useCallback((v: string, cursor?: number) => {
    setState({ value: v, cursor: cursor ?? v.length });
  }, []);

  const reset = useCallback(() => setState({ value: '', cursor: 0 }), []);

  const onKey = useCallback((input: string, key: KeyInfo): 'submit' | 'consumed' | 'passthrough' => {
    let outcome: 'submit' | 'consumed' | 'passthrough' = 'consumed';

    setState(prev => {
      const { value, cursor } = prev;

      if (key.return) {
        outcome = 'submit';
        return prev;
      }

      if (key.leftArrow) return { value, cursor: Math.max(0, cursor - 1) };
      if (key.rightArrow) return { value, cursor: Math.min(value.length, cursor + 1) };

      if (key.ctrl && key.name === 'a') return { value, cursor: 0 };
      if (key.ctrl && key.name === 'e') return { value, cursor: value.length };
      if (key.ctrl && key.name === 'u') return { value: value.slice(cursor), cursor: 0 };
      if (key.ctrl && key.name === 'k') return { value: value.slice(0, cursor), cursor };
      if (key.ctrl && key.name === 'w') {
        // delete previous word
        let i = cursor - 1;
        while (i >= 0 && value[i] === ' ') i--;
        while (i >= 0 && value[i] !== ' ') i--;
        return { value: value.slice(0, i + 1) + value.slice(cursor), cursor: i + 1 };
      }

      if (key.backspace) {
        if (cursor === 0) return prev;
        return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
      }
      if (key.delete) {
        if (cursor === value.length) return prev;
        return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
      }

      if (input && !key.ctrl && !key.meta) {
        return { value: value.slice(0, cursor) + input + value.slice(cursor), cursor: cursor + input.length };
      }

      outcome = 'passthrough';
      return prev;
    });

    return outcome;
  }, []);

  return { state, onKey, setValue, reset };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter deepseek-code exec vitest run src/ui/hooks/useLineEditor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/ui/hooks/useLineEditor.ts packages/cli/src/ui/hooks/useLineEditor.test.ts packages/cli/package.json packages/cli/pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "feat(cli): useLineEditor hook with emacs-style bindings"
```

---

## Task 10: SuggestionMenu Component

**Files:**
- Create: `packages/cli/src/ui/SuggestionMenu.tsx`

**Interfaces:**
- Produces:
  ```tsx
  interface SuggestionItem {
    key: string;
    label: string;
    hint?: string;      // right-side dim text (source tag or arg-hint)
    matches?: number[];  // char indices to highlight in label
  }
  interface SuggestionMenuProps {
    items: SuggestionItem[];
    selectedIndex: number;
    footer?: string;
  }
  function SuggestionMenu(props): ReactNode
  ```

- [ ] **Step 1: Implement component**

```tsx
// packages/cli/src/ui/SuggestionMenu.tsx
import React from 'react';
import { Box, Text } from 'ink';

export interface SuggestionItem {
  key: string;
  label: string;
  hint?: string;
  matches?: number[];
}

export interface SuggestionMenuProps {
  items: SuggestionItem[];
  selectedIndex: number;
  footer?: string;
}

function HighlightedLabel({ label, matches }: { label: string; matches?: number[] }) {
  if (!matches || matches.length === 0) return <Text>{label}</Text>;
  const set = new Set(matches);
  return (
    <Text>
      {[...label].map((ch, i) => set.has(i)
        ? <Text key={i} color="cyan" bold>{ch}</Text>
        : <Text key={i}>{ch}</Text>)}
    </Text>
  );
}

export function SuggestionMenu({ items, selectedIndex, footer }: SuggestionMenuProps) {
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={0}>
      {items.map((it, i) => {
        const selected = i === selectedIndex;
        return (
          <Box key={it.key}>
            <Text color={selected ? 'black' : 'white'} backgroundColor={selected ? 'cyan' : undefined}>
              {selected ? '▶ ' : '  '}
            </Text>
            <HighlightedLabel label={it.label} matches={it.matches} />
            {it.hint && <Text color="gray">  {it.hint}</Text>}
          </Box>
        );
      })}
      {footer && <Text color="gray">  {footer}</Text>}
    </Box>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter deepseek-code exec tsc -p tsconfig.json --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/ui/SuggestionMenu.tsx
git -c commit.gpgsign=false commit -m "feat(cli): SuggestionMenu component with highlighted matches"
```

---

## Task 11: InputBox Component

**Files:**
- Create: `packages/cli/src/ui/InputBox.tsx`

**Interfaces:**
- Consumes: `useLineEditor`, `SuggestionMenu`, `CommandRegistry`, `FileIndex`
- Produces:
  ```tsx
  interface InputBoxProps {
    registry: CommandRegistry
    fileIndex: FileIndex
    history: string[]
    isRunning: boolean
    onSubmit(input: string, attachments: string[]): void
    onAbort(): void
    onExit(): void
    onMemoryAppend(scope: 'project' | 'user', text: string): void
  }
  function InputBox(props): ReactNode
  ```

- [ ] **Step 1: Implement InputBox**

```tsx
// packages/cli/src/ui/InputBox.tsx
import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { CommandRegistry, Command, FileIndex } from '@deepseek-code/core';
import { useLineEditor } from './hooks/useLineEditor.js';
import { SuggestionMenu, type SuggestionItem } from './SuggestionMenu.js';

type MenuKind = 'none' | 'command' | 'model' | 'file' | 'memoryScope';

const MODEL_OPTIONS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

export interface InputBoxProps {
  registry: CommandRegistry;
  fileIndex: FileIndex;
  history: string[];
  isRunning: boolean;
  onSubmit(input: string, attachments: string[]): void;
  onAbort(): void;
  onExit(): void;
  onMemoryAppend(scope: 'project' | 'user', text: string): void;
}

function currentToken(value: string, cursor: number): { start: number; end: number; text: string } {
  let start = cursor;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  let end = cursor;
  while (end < value.length && !/\s/.test(value[end])) end++;
  return { start, end, text: value.slice(start, end) };
}

function detectMenu(value: string, cursor: number): { kind: MenuKind; query: string; tokenStart: number } {
  const tok = currentToken(value, cursor);
  const trimmed = value.trimStart();

  if (value.startsWith('#')) {
    return { kind: 'memoryScope', query: value.slice(1).trim(), tokenStart: 0 };
  }

  if (tok.text.startsWith('@')) {
    return { kind: 'file', query: tok.text.slice(1), tokenStart: tok.start };
  }

  if (trimmed.startsWith('/model ')) {
    return { kind: 'model', query: trimmed.slice(7).trim(), tokenStart: value.length - trimmed.slice(7).length };
  }

  if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
    return { kind: 'command', query: trimmed.slice(1), tokenStart: 0 };
  }

  return { kind: 'none', query: '', tokenStart: 0 };
}

export function InputBox(props: InputBoxProps) {
  const { registry, fileIndex, history, isRunning, onSubmit, onAbort, onExit, onMemoryAppend } = props;
  const editor = useLineEditor();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [historyPos, setHistoryPos] = useState(-1);
  const [draft, setDraft] = useState('');

  const { value, cursor } = editor.state;
  const menu = useMemo(() => detectMenu(value, cursor), [value, cursor]);

  const items: SuggestionItem[] = useMemo(() => {
    switch (menu.kind) {
      case 'command': {
        return registry.filter(menu.query).slice(0, 8).map(({ cmd, matches }) => ({
          key: cmd.name,
          label: `/${cmd.name}`,
          hint: `${cmd.description}  [${cmd.source}]${cmd.argumentHint ? '  ' + cmd.argumentHint : ''}`,
          matches: matches.map(i => i + 1), // +1 for leading '/'
        }));
      }
      case 'model': {
        return MODEL_OPTIONS
          .filter(m => m.startsWith(menu.query))
          .map(m => ({ key: m, label: m }));
      }
      case 'file': {
        return fileIndex.search(menu.query, 8).map(h => ({
          key: h.path, label: '@' + h.path, matches: h.matches.map(i => i + 1),
        }));
      }
      case 'memoryScope': {
        return [
          { key: 'project', label: '项目级', hint: 'DEEPSEEK.md（本仓库）' },
          { key: 'user', label: '用户级', hint: '~/.deepseek-code/DEEPSEEK.md（所有项目）' },
        ];
      }
      default:
        return [];
    }
  }, [menu, registry, fileIndex]);

  React.useEffect(() => {
    if (selectedIdx >= items.length) setSelectedIdx(0);
  }, [items.length, selectedIdx]);

  const commit = useCallback((raw: string) => {
    // extract @attachments
    const attachments: string[] = [];
    for (const m of raw.matchAll(/@([^\s]+)/g)) {
      attachments.push(m[1]);
    }
    onSubmit(raw, attachments);
    editor.reset();
    setSelectedIdx(0);
    setHistoryPos(-1);
    setDraft('');
  }, [editor, onSubmit]);

  const applySelection = useCallback(() => {
    if (items.length === 0) return;
    const it = items[selectedIdx];
    switch (menu.kind) {
      case 'command':
        editor.setValue(it.label + ' ');
        break;
      case 'model':
        editor.setValue('/model ' + it.key);
        break;
      case 'file': {
        const before = value.slice(0, menu.tokenStart);
        const after = value.slice(cursor);
        const inserted = '@' + it.key + ' ';
        editor.setValue(before + inserted + after, (before + inserted).length);
        break;
      }
      case 'memoryScope': {
        const text = value.slice(1).trim();
        if (text) onMemoryAppend(it.key as 'project' | 'user', text);
        editor.reset();
        break;
      }
    }
    setSelectedIdx(0);
  }, [items, selectedIdx, menu, editor, value, cursor, onMemoryAppend]);

  useInput((input, key) => {
    if (isRunning) {
      if (key.escape || (key.ctrl && input === 'c')) onAbort();
      return;
    }

    // menu navigation
    if (items.length > 0) {
      if (key.upArrow) { setSelectedIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSelectedIdx(i => Math.min(items.length - 1, i + 1)); return; }
      if (key.tab) { applySelection(); return; }
    } else {
      // history
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyPos === -1) setDraft(value);
        const newIdx = historyPos === -1 ? history.length - 1 : Math.max(0, historyPos - 1);
        setHistoryPos(newIdx);
        editor.setValue(history[newIdx]);
        return;
      }
      if (key.downArrow) {
        if (historyPos === -1) return;
        const newIdx = historyPos + 1;
        if (newIdx >= history.length) {
          setHistoryPos(-1);
          editor.setValue(draft);
        } else {
          setHistoryPos(newIdx);
          editor.setValue(history[newIdx]);
        }
        return;
      }
    }

    if (key.escape) {
      if (items.length > 0) { setSelectedIdx(-1); return; }
      editor.reset();
      return;
    }

    if (key.ctrl && input === 'c') {
      if (value === '') onExit(); else editor.reset();
      return;
    }
    if (key.ctrl && input === 'd' && value === '') { onExit(); return; }

    const outcome = editor.onKey(input, key as any);
    if (outcome === 'submit') {
      if (items.length > 0 && menu.kind !== 'memoryScope') {
        // Enter with menu open on command/file/model → treat as apply
        applySelection();
        return;
      }
      if (menu.kind === 'memoryScope') {
        applySelection();
        return;
      }
      const trimmed = value.trim();
      if (trimmed) commit(trimmed);
    }
  });

  // Render
  const beforeCursor = value.slice(0, cursor);
  const afterCursor = value.slice(cursor);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">{isRunning ? '⏸ ' : '> '}</Text>
        <Text>{beforeCursor}</Text>
        <Text inverse>{afterCursor[0] ?? ' '}</Text>
        <Text>{afterCursor.slice(1)}</Text>
        {isRunning && <Text color="gray">  <Spinner type="dots" /> running · Esc to abort</Text>}
      </Box>
      {!isRunning && items.length > 0 && (
        <SuggestionMenu
          items={items}
          selectedIndex={Math.max(0, selectedIdx)}
          footer="↑↓ 选择 · Enter/Tab 补全 · Esc 关闭"
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter deepseek-code exec tsc -p tsconfig.json --noEmit`
Expected: no new errors related to InputBox

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/ui/InputBox.tsx
git -c commit.gpgsign=false commit -m "feat(cli): InputBox with fuzzy suggestions, @file, #memory, history nav"
```

---

## Task 12: Persistent Ink App shell

**Files:**
- Modify: `packages/cli/src/ui/App.tsx`

**Interfaces:**
- Consumes: `AgentStream`, `InputBox`, `useAgentStream`
- Produces:
  ```ts
  interface AppShellProps {
    registry: CommandRegistry
    fileIndex: FileIndex
    getModel(): string
    getSessionId(): string
    getMsgCount(): number
    isRunning: boolean
    events: AsyncIterable<AgentEvent> | null
    history: string[]
    onSubmit(input: string, attachments: string[]): void
    onAbort(): void
    onExit(): void
    onMemoryAppend(scope: 'project' | 'user', text: string): void
  }
  function AppShell(props): ReactNode
  function mountAppShell(deps): { updateEvents: (e: AsyncIterable<AgentEvent> | null) => void; setStatus: (s: Partial<StatusFields>) => void; unmount: () => void }
  ```

- [ ] **Step 1: Rewrite App.tsx**

Replace the entire content of `packages/cli/src/ui/App.tsx`:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text } from 'ink';
import type { AgentEvent, CommandRegistry, FileIndex } from '@deepseek-code/core';
import { AgentStream } from './AgentStream.js';
import { useAgentStream } from './hooks/useAgentStream.js';
import { InputBox } from './InputBox.js';

interface StatusFields {
  model: string;
  sessionId: string;
  msgCount: number;
  flash?: string;
}

interface AppShellProps {
  registry: CommandRegistry;
  fileIndex: FileIndex;
  initialStatus: StatusFields;
  history: string[];
  eventsRef: { current: AsyncIterable<AgentEvent> | null };
  statusRef: { current: StatusFields };
  onSubmit(input: string, attachments: string[]): void;
  onAbort(): void;
  onExit(): void;
  onMemoryAppend(scope: 'project' | 'user', text: string): void;
  bindUpdater(fn: () => void): void;
}

function AppShell(props: AppShellProps) {
  const [status, setStatus] = useState(props.initialStatus);
  const [events, setEvents] = useState<AsyncIterable<AgentEvent> | null>(null);
  const [history, setHistory] = useState(props.history);

  useEffect(() => {
    props.bindUpdater(() => {
      setEvents(props.eventsRef.current);
      setStatus({ ...props.statusRef.current });
    });
  }, []);

  const streamState = useAgentStream(events);

  const handleSubmit = useCallback((input: string, attachments: string[]) => {
    setHistory(h => (h[h.length - 1] === input ? h : [...h, input]));
    props.onSubmit(input, attachments);
  }, [props]);

  return (
    <Box flexDirection="column">
      <AgentStream state={streamState} />
      <Box marginTop={1}>
        <Text color="gray">
          model: {status.model}  ·  session: {status.sessionId.slice(0, 8)}  ·  msgs: {status.msgCount}
          {status.flash ? '  ·  ' + status.flash : ''}
        </Text>
      </Box>
      <InputBox
        registry={props.registry}
        fileIndex={props.fileIndex}
        history={history}
        isRunning={streamState.isRunning}
        onSubmit={handleSubmit}
        onAbort={props.onAbort}
        onExit={props.onExit}
        onMemoryAppend={props.onMemoryAppend}
      />
    </Box>
  );
}

export interface MountedApp {
  updateEvents(e: AsyncIterable<AgentEvent> | null): void;
  updateStatus(s: Partial<StatusFields>): void;
  unmount(): void;
}

export interface MountDeps {
  registry: CommandRegistry;
  fileIndex: FileIndex;
  initialStatus: StatusFields;
  history: string[];
  onSubmit(input: string, attachments: string[]): void;
  onAbort(): void;
  onExit(): void;
  onMemoryAppend(scope: 'project' | 'user', text: string): void;
}

export function mountAppShell(deps: MountDeps): MountedApp {
  const eventsRef: { current: AsyncIterable<AgentEvent> | null } = { current: null };
  const statusRef: { current: StatusFields } = { current: { ...deps.initialStatus } };
  let notify: () => void = () => {};

  const instance = render(
    <AppShell
      registry={deps.registry}
      fileIndex={deps.fileIndex}
      initialStatus={deps.initialStatus}
      history={deps.history}
      eventsRef={eventsRef}
      statusRef={statusRef}
      onSubmit={deps.onSubmit}
      onAbort={deps.onAbort}
      onExit={deps.onExit}
      onMemoryAppend={deps.onMemoryAppend}
      bindUpdater={(fn) => { notify = fn; }}
    />,
    { exitOnCtrlC: false },
  );

  return {
    updateEvents(e) { eventsRef.current = e; notify(); },
    updateStatus(s) { statusRef.current = { ...statusRef.current, ...s }; notify(); },
    unmount() { instance.unmount(); },
  };
}

// Backward compat export for renderWithInk one-shot mode (non-REPL)
export async function renderWithInk(
  events: AsyncIterable<AgentEvent>,
): Promise<{ exitCode: number }> {
  // Minimal legacy path: mount, feed events once, wait for done.
  return new Promise(resolve => {
    let exitCode = 0;
    const app = mountAppShell({
      registry: new (class { list = () => []; filter = () => []; resolve = () => undefined; } as any)(),
      fileIndex: { all: () => [], search: () => [], load: () => {} } as any,
      initialStatus: { model: '', sessionId: 'oneshot', msgCount: 0 },
      history: [],
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
      onMemoryAppend: () => {},
    });
    app.updateEvents(events);
    (async () => {
      for await (const ev of events) {
        if (ev.type === 'done') {
          if (ev.reason === 'fatal' || ev.reason === 'max_steps') exitCode = 1;
          if (ev.reason === 'abort') exitCode = 130;
          break;
        }
      }
      setTimeout(() => { app.unmount(); resolve({ exitCode }); }, 50);
    })();
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter deepseek-code exec tsc -p tsconfig.json --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/ui/App.tsx
git -c commit.gpgsign=false commit -m "refactor(cli): App.tsx becomes persistent Ink shell with mount API"
```

---

## Task 13: New REPL wired to persistent Ink

**Files:**
- Modify: `packages/cli/src/repl.ts`
- Modify: `packages/cli/src/main.ts`

**Interfaces:**
- Consumes: `mountAppShell`, `routeInput`, `CommandRegistry`, `FileIndex`, `appendMemory`, `compactMessages`

- [ ] **Step 1: Rewrite repl.ts**

Replace `packages/cli/src/repl.ts` with:

```ts
import pc from 'picocolors';
import type { Session, SessionStore, SkillRegistry, Config, Provider } from '@deepseek-code/core';
import {
  CommandRegistry, FileIndex, appendMemory,
  buildSystemPrompt, compactMessages,
} from '@deepseek-code/core';
import { mountAppShell, type MountedApp } from './ui/App.js';
import { routeInput } from './router/index.js';
import { registerBuiltins, runBuiltin } from './router/builtins.js';

export interface ReplDeps {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  runTurn: (
    input: string,
    session: Session,
    signal: AbortSignal,
    opts?: { modelOverride?: string; allowedTools?: string[]; attachments?: string[] },
  ) => Promise<number>;
  session: Session;
  getModel: () => string;
  setModel: (m: string) => void;
  sessionStore?: SessionStore;
  skillRegistry?: SkillRegistry;
  config?: Config;
  configSources?: Record<string, string>;
  provider?: Provider;
  cwd: string;
}

export async function startRepl(deps: ReplDeps): Promise<number> {
  const registry = new CommandRegistry();
  registerBuiltins(registry);
  registry.loadFromDisk({ cwd: deps.cwd });
  if (deps.skillRegistry) {
    registry.ingestSkillCommands(deps.skillRegistry.list());
  }

  const fileIndex = new FileIndex({ cwd: deps.cwd });
  fileIndex.load();

  let activeAbort: AbortController | null = null;
  const history: string[] = [];
  let app!: MountedApp;
  let exitCode = 0;
  let exiting = false;

  const flashStatus = (msg: string) => {
    app.updateStatus({ flash: msg });
    setTimeout(() => app.updateStatus({ flash: undefined }), 2000);
  };

  const doExit = () => {
    exiting = true;
    if (activeAbort) activeAbort.abort();
    app.unmount();
  };

  const onSubmit = async (raw: string, attachments: string[]) => {
    const action = routeInput(raw, registry);

    if (action.kind === 'passthrough') {
      activeAbort = new AbortController();
      exitCode = await deps.runTurn(raw, deps.session, activeAbort.signal, { attachments });
      activeAbort = null;
      app.updateStatus({ msgCount: deps.session.messages.length });
      return;
    }
    if (action.kind === 'builtin') {
      const result = await runBuiltin(action.name, action.args, {
        session: deps.session,
        stdout: deps.stdout,
        getModel: deps.getModel,
        setModel: (m) => { deps.setModel(m); app.updateStatus({ model: m }); },
        sessionStore: deps.sessionStore,
        skillRegistry: deps.skillRegistry,
        config: deps.config,
        configSources: deps.configSources,
        provider: deps.provider,
        cwd: deps.cwd,
        registry,
        flashStatus,
      });
      if (result === 'quit') doExit();
      app.updateStatus({ msgCount: deps.session.messages.length });
      return;
    }
    if (action.kind === 'agent') {
      const prev = deps.getModel();
      if (action.modelOverride) deps.setModel(action.modelOverride);
      activeAbort = new AbortController();
      exitCode = await deps.runTurn(action.prompt, deps.session, activeAbort.signal, {
        allowedTools: action.allowedTools,
        attachments,
      });
      activeAbort = null;
      if (action.modelOverride) deps.setModel(prev);
      app.updateStatus({ msgCount: deps.session.messages.length, model: deps.getModel() });
      return;
    }
    if (action.kind === 'unknown') {
      // /skills/<name> legacy path
      const skillMatch = raw.match(/^\/skills\/([^\s]+)(?:\s+(.*))?$/);
      if (skillMatch && deps.skillRegistry) {
        const [, skillName, prompt] = skillMatch;
        const skill = deps.skillRegistry.getByCommand(skillName)
          ?? deps.skillRegistry.list().find(s => s.name === skillName);
        if (skill) {
          const enriched = `[Skill: ${skill.name}]\n${skill.content}\n\n---\n${prompt || '请按以上技能指引执行'}`;
          activeAbort = new AbortController();
          exitCode = await deps.runTurn(enriched, deps.session, activeAbort.signal, { attachments });
          activeAbort = null;
          app.updateStatus({ msgCount: deps.session.messages.length });
          return;
        }
      }
      flashStatus(pc.red(`未知命令: /${action.name}`));
    }
  };

  const onMemoryAppend = (scope: 'project' | 'user', text: string) => {
    const r = appendMemory({ scope, text, cwd: deps.cwd });
    // rebuild system prompt for next turn
    const alwaysOn = deps.skillRegistry?.getAlwaysOn() ?? [];
    const newSys = buildSystemPrompt({ cwd: deps.cwd, skills: alwaysOn, model: deps.getModel() });
    // rewrite system message in place
    const sysIdx = deps.session.messages.findIndex(m => m.role === 'system');
    if (sysIdx >= 0) deps.session.messages[sysIdx].content = newSys;
    flashStatus(pc.green(`✓ 已${r.created ? '创建' : '追加到'}${scope === 'project' ? '项目' : '用户'}级 memory`));
  };

  app = mountAppShell({
    registry, fileIndex,
    initialStatus: {
      model: deps.getModel(),
      sessionId: deps.session.id,
      msgCount: deps.session.messages.length,
    },
    history,
    onSubmit,
    onAbort: () => { if (activeAbort) activeAbort.abort(); },
    onExit: doExit,
    onMemoryAppend,
  });

  // Wait for unmount
  await new Promise<void>(resolve => {
    const check = setInterval(() => {
      if (exiting) { clearInterval(check); resolve(); }
    }, 100);
  });

  return exitCode;
}
```

- [ ] **Step 2: Create router/builtins.ts**

```ts
// packages/cli/src/router/builtins.ts
import pc from 'picocolors';
import type { Session, SessionStore, SkillRegistry, Config, Provider } from '@deepseek-code/core';
import { CommandRegistry, compactMessages } from '@deepseek-code/core';

export interface BuiltinCtx {
  session: Session;
  stdout: NodeJS.WritableStream;
  getModel: () => string;
  setModel: (m: string) => void;
  sessionStore?: SessionStore;
  skillRegistry?: SkillRegistry;
  config?: Config;
  configSources?: Record<string, string>;
  provider?: Provider;
  cwd: string;
  registry: CommandRegistry;
  flashStatus: (msg: string) => void;
}

export function registerBuiltins(registry: CommandRegistry): void {
  const entries: Array<{ name: string; description: string; argumentHint?: string }> = [
    { name: 'help', description: '显示可用命令列表' },
    { name: 'model', description: '查看或切换模型', argumentHint: '<name>' },
    { name: 'config', description: '显示当前配置及来源' },
    { name: 'plan', description: '进入规划模式', argumentHint: '<prompt>' },
    { name: 'skills', description: '列出可用技能' },
    { name: 'clear', description: '清空当前会话历史' },
    { name: 'sessions', description: '列出历史会话' },
    { name: 'compact', description: '手动触发历史压缩' },
    { name: 'memory', description: '编辑 DEEPSEEK.md' },
    { name: 'init', description: '生成 commands 目录骨架' },
    { name: 'resume', description: '在 REPL 内切换会话', argumentHint: '<id>' },
    { name: 'quit', description: '退出 REPL' },
  ];
  for (const e of entries) {
    registry.registerBuiltin({ ...e, body: '', source: 'builtin' });
  }
}

export async function runBuiltin(name: string, args: string, ctx: BuiltinCtx): Promise<'quit' | void> {
  const w = (s: string) => ctx.stdout.write(s);
  switch (name) {
    case 'help': {
      w(pc.bold('\n可用命令：\n'));
      const groups: Record<string, string[]> = { builtin: [], project: [], user: [], skill: [] };
      for (const c of ctx.registry.list()) {
        groups[c.source].push(`  ${pc.cyan(('/' + c.name).padEnd(16))} ${c.description}`);
      }
      for (const [k, lines] of Object.entries(groups)) {
        if (lines.length === 0) continue;
        w(pc.gray(`\n[${k}]\n`));
        for (const l of lines) w(l + '\n');
      }
      w('\n');
      return;
    }
    case 'model': {
      if (!args) {
        w(`当前模型: ${pc.green(ctx.getModel())}\n`);
      } else {
        ctx.setModel(args.trim());
        w(`已切换模型为: ${pc.green(args.trim())}\n`);
      }
      return;
    }
    case 'config': {
      if (ctx.config && ctx.configSources) {
        w(pc.bold('\n当前配置：\n'));
        for (const [key, value] of Object.entries(ctx.config).filter(([k]) => k !== 'mcpServers')) {
          const src = ctx.configSources[key] ?? 'default';
          const display = key === 'apiKey' ? `${String(value).slice(0, 6)}...` : String(value);
          w(`  ${pc.cyan(key.padEnd(16))} ${display.padEnd(30)} ${pc.dim('[' + src + ']')}\n`);
        }
        w('\n');
      }
      return;
    }
    case 'clear': {
      const sys = ctx.session.messages.find(m => m.role === 'system');
      ctx.session.messages = sys ? [sys] : [];
      ctx.session.readFiles.clear();
      ctx.flashStatus(pc.gray('已清空会话历史'));
      return;
    }
    case 'sessions': {
      if (!ctx.sessionStore) { w('会话存储不可用\n'); return; }
      const list = ctx.sessionStore.list();
      if (list.length === 0) { w('暂无历史会话\n'); return; }
      w(`\n共 ${list.length} 个会话：\n`);
      for (const s of list.slice(0, 10)) {
        w(`  ${pc.dim(s.id)}  ${new Date(s.lastActiveAt).toLocaleString('zh-CN')}  [${s.messageCount}条]  ${s.firstUserMessage.slice(0, 40)}\n`);
      }
      w('\n');
      return;
    }
    case 'compact': {
      if (!ctx.provider) { w(pc.gray('provider 不可用，跳过\n')); return; }
      const before = ctx.session.messages.length;
      const ctrl = new AbortController();
      const result = await compactMessages(ctx.session.messages, ctx.provider, ctrl.signal, {
        model: ctx.getModel(),
        compactModel: ctx.config?.compactModel,
      });
      ctx.session.messages = result.messages;
      w(pc.gray(`已压缩 ${result.removedCount} 条消息（${before} → ${ctx.session.messages.length}）\n`));
      return;
    }
    case 'skills': {
      if (!ctx.skillRegistry) { w('Skills 未初始化\n'); return; }
      const skills = ctx.skillRegistry.list();
      w(pc.bold(`\n已加载 ${skills.length} 个技能：\n`));
      for (const s of skills) {
        const trigger = s.trigger.type === 'always' ? '常驻'
          : s.trigger.type === 'auto' ? '自动'
          : `/${s.trigger.type === 'command' ? (s.trigger as any).name : s.name}`;
        w(`  ${pc.cyan(s.name.padEnd(24))} ${pc.dim('[' + trigger + ']')} ${s.description}\n`);
      }
      w('\n');
      return;
    }
    case 'plan': {
      // plan mode is intercepted at runTurn by main.ts flag. For REPL:
      // Insert marker into input for runTurn path — handled via passthrough with "/plan " prefix.
      // Here we just print a hint since agent path handles it.
      w(pc.gray('提示：/plan <prompt> 现在由 runTurn 处理，无需手动触发。\n'));
      return;
    }
    case 'memory': {
      const { spawn } = await import('node:child_process');
      const path = args === 'user'
        ? (await import('node:path')).join((await import('node:os')).homedir(), '.deepseek-code', 'DEEPSEEK.md')
        : (await import('node:path')).join(ctx.cwd, 'DEEPSEEK.md');
      const editor = process.env.EDITOR ?? 'vi';
      const child = spawn(editor, [path], { stdio: 'inherit' });
      await new Promise<void>(res => child.on('exit', () => res()));
      return;
    }
    case 'init': {
      const { existsSync, mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dir = join(ctx.cwd, '.deepseek-code', 'commands');
      mkdirSync(dir, { recursive: true });
      const sample = join(dir, 'hello.md');
      if (!existsSync(sample)) {
        writeFileSync(sample, `---
description: Sample command
argument-hint: <name>
---
Say hello to $1. Extra: $ARGUMENTS
`);
      }
      w(pc.green(`✓ 已创建 ${dir}\n`));
      return;
    }
    case 'resume': {
      if (!ctx.sessionStore) { w('会话存储不可用\n'); return; }
      const id = args.trim();
      if (!id) { w('用法: /resume <id>\n'); return; }
      const s = ctx.sessionStore.get(id);
      if (!s) { w(pc.red(`会话 ${id} 不存在\n`)); return; }
      Object.assign(ctx.session, s);
      ctx.flashStatus(pc.green(`✓ 已切换到会话 ${id}`));
      return;
    }
    case 'quit':
    case 'exit':
      return 'quit';
  }
}
```

- [ ] **Step 3: Update main.ts**

Modify `packages/cli/src/main.ts`:

Replace the `runTurn` invocation and REPL startup section. Find:

```ts
    // 匹配 /plan（带或不带参数）、/plan foo、以及 --plan 全局选项
    const usePlan = opts.plan || input.startsWith('/plan');
    const actualInput = input.startsWith('/plan')
      ? input.slice(5).trimStart()
      : input;
```

Replace with:

```ts
    const usePlan = opts.plan;
    const actualInput = input;
```

Change `runTurn` signature:

```ts
  const runTurn = async (
    input: string,
    _sess = session,
    signal?: AbortSignal,
    turnOpts?: { modelOverride?: string; allowedTools?: string[]; attachments?: string[] },
  ): Promise<number> => {
```

Inside `runTurn`, prepend attachments before agent call:

```ts
    // Attachment note (before compact check)
    const attachmentNote = turnOpts?.attachments && turnOpts.attachments.length > 0
      ? `[attached files]\n${turnOpts.attachments.map(a => '- ' + a).join('\n')}\n\n`
      : '';
    const finalInput = attachmentNote + actualInput;
```

And pass `finalInput` where `actualInput` was used to `runAgentLoop` / `runPlanMode`.

Update the REPL start call:

```ts
    return startRepl({
      stdin: process.stdin,
      stdout: process.stdout,
      session,
      runTurn,
      getModel: () => currentModel,
      setModel: (m) => { currentModel = m; },
      sessionStore,
      skillRegistry,
      config,
      configSources,
      provider,
      cwd,
    });
```

- [ ] **Step 4: Full build & typecheck**

Run:
```bash
pnpm -r build 2>&1 | tail -30
```
Expected: successful build across all packages.

- [ ] **Step 5: Manual smoke test**

Run:
```bash
node packages/cli/dist/main.js
```

Then in the REPL check:
1. Empty `/` — menu shows all builtins with `[builtin]` tag
2. `/mo` — menu narrows to `/model` `/memory` (fuzzy)
3. ↓ then Enter — applies `/memory ` (with trailing space)
4. `/help` Enter — shows grouped help
5. `@src/` — file panel appears with fuzzy matches
6. Select a file, add text, submit — see "[attached files]" preface in assistant turn (verify via debug logs)
7. `#no more mocks` Enter — scope prompt appears; select project → status bar flashes "已追加"; verify `DEEPSEEK.md` updated
8. Long text turn: press Esc mid-stream — turn aborts
9. `/clear` — history clears, banner still visible
10. `/compact` (with enough history) — shows before/after count
11. Ctrl+D on empty line — exits

Fix any interaction bug found.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/repl.ts packages/cli/src/router/builtins.ts packages/cli/src/main.ts
git -c commit.gpgsign=false commit -m "feat(cli): persistent Ink REPL with slash router and builtin handlers"
```

---

## Task 14: README update

**Files:**
- Modify: `README.md`, `README.zh-CN.md`

- [ ] **Step 1: Update slash-commands table in README**

Replace the "REPL Slash Commands" section table:

```markdown
## REPL Slash Commands

Type `/` to open a fuzzy-matched command menu. Use ↑↓ to select, Enter/Tab to submit.

| Command | Description |
|---|---|
| `/help` | Show grouped list of all commands |
| `/model [name]` | View or switch model |
| `/plan <prompt>` | Plan mode |
| `/clear` | Clear session history |
| `/sessions` | List sessions |
| `/resume <id>` | Switch to another session inside REPL |
| `/compact` | Manually compress history |
| `/config` | Show effective config |
| `/skills` | List available skills |
| `/memory [user]` | Open DEEPSEEK.md in $EDITOR |
| `/init` | Scaffold `.deepseek-code/commands/` |
| `/quit` | Exit |

## User Commands

Drop `.md` files under `.deepseek-code/commands/` (project) or `~/.deepseek-code/commands/` (user):

```markdown
---
description: Create a PR
argument-hint: <base-branch>
allowed-tools: [Bash, Read]
model: deepseek-chat
---
Please open a PR against $1. Extra: $ARGUMENTS
```

Subdirectories become namespaces: `commands/git/pr.md` → `/git:pr`.

## Trigger characters

- `@path` — attach a file reference (fuzzy autocomplete of git-tracked + cwd files)
- `#text` — append `text` to DEEPSEEK.md (choose project or user scope)
```

Mirror the changes into `README.zh-CN.md`.

- [ ] **Step 2: Commit**

```bash
git add README.md README.zh-CN.md
git -c commit.gpgsign=false commit -m "docs: document slash-command parity, user commands, @/# triggers"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test 2>&1 | tail -30`
Expected: all tests pass; no snapshot mismatches.

- [ ] **Step 2: Full typecheck**

Run: `pnpm -r typecheck 2>&1 | tail -30`
Expected: no type errors.

- [ ] **Step 3: Manual REPL smoke re-run**

Re-run steps 1-11 from Task 13 Step 5 to confirm nothing regressed after README + polish.

- [ ] **Step 4: Verification skill**

Invoke `superpowers:verification-before-completion` and confirm actual test / build output before claiming done.

- [ ] **Step 5: Final commit (if any polish)**

```bash
git status
# if clean: no final commit needed
```

---

## Self-Review Notes

**Coverage matrix (spec → task)**

| Spec item | Task |
|---|---|
| Ink 单一持久实例 | 12, 13 |
| 删除 readline / SuggestionRenderer / createCompleter | 13 |
| CommandRegistry + 四类优先级 | 4 |
| 用户命令 frontmatter + `$1/$ARGUMENTS` | 2 |
| 命名空间 `git:pr` | 2 |
| `allowed-tools` / `model` override | 7, 13 |
| InputBox 菜单 ↑↓/Enter/Tab/Esc | 11 |
| 模糊匹配 + 高亮 | 1, 10, 11 |
| `@file` git-tracked + cwd 兜底 | 6, 11, 13 |
| `#memory` 追加 + 热重载 | 5, 11, 13 |
| `/clear` 去 --force / 用 flash | 13 |
| `/compact` 真跑 | 13 |
| `/help` 分类 | 13 |
| `/init` 骨架 | 13 |
| `/memory` 编辑 | 13 |
| `/resume` REPL 内切换 | 13 |
| 状态栏 model/session/msgs | 12, 13 |
| Emacs 快捷键 | 9, 11 |
| 输入历史 ↑↓ | 11 |
| 保留 `/skills/<name>` | 13 |

**Assumption notes**

- Ink `useInput` provides `upArrow / downArrow / leftArrow / rightArrow / tab / return / escape / ctrl / meta / backspace / delete` on the `key` object. Confirmed against Ink v5 docs.
- `@testing-library/react` for hook testing may need `--environment jsdom`; if vitest config lacks it, add jsdom to the file's test hook config.
- `readline` free — using Ink for stdin only.
- `provider` is passed to REPL so `/compact` can invoke `compactMessages`.

**Risks flagged in spec — addressed**

- `mode: idle | running` = expressed via `isRunning` derived from `useAgentStream`
- Windows keys: not tested; document as best-effort
- Large repos: `FileIndex.search` caps at `limit` (default 30) after scoring
- `allowed-tools`: routed via `runTurn` opts; permission engine integration is a follow-up if not yet wired (add TODO in code if PermissionEngine doesn't support per-turn override)
- Namespace conflict: registry priority guarantees builtin cannot be shadowed
