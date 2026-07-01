# Slash Command 全面对齐 Claude Code — Design Spec

Date: 2026-07-01
Owner: Luna
Status: Approved (sections 1–4 by user, section 5 auto-approved per user's "做完这个任务" instruction)

## 背景

`deepseek-code` v0.3 的 REPL slash-command 体验有以下痛点：

- 输入行用 `node:readline`，输出用 Ink（`ui/App.tsx`），两套渲染各干各的，每 turn 重新 mount/unmount Ink，切换时闪烁、光标错位
- 建议菜单（`SuggestionRenderer`）用手写 ANSI 转义码在 readline 下方绘制，**不可 ↑↓ 选中**，只能靠继续打字 or Tab 补齐
- `/clear` 要求用户手动敲 `--force`；`/compact` 只是空占位符
- 命令、模型、skills 名都是硬编码
- 缺失能力：用户自定义命令文件、`@file` 引用补全、`#memory` 快捷追加、模糊匹配、参数提示、命令分类

用户目标：**slash command 全面对齐 Claude Code 的丝滑体验**。

## 目标 / 非目标

**In scope**

1. 输入引擎切到 Ink，删除 readline，去掉所有手写 ANSI 逻辑
2. 建议菜单可 ↑↓ 选中 + Enter 提交，支持模糊匹配、命中高亮、类别标签
3. 用户自定义命令：Markdown + YAML frontmatter，支持项目级 & 用户级、命名空间、`$1`/`$ARGUMENTS` 占位、`allowed-tools`、`argument-hint`、`model` override
4. `@file` 触发文件面板（git-tracked 优先 + cwd 兜底 + 模糊）
5. `#memory` 一键追加到 `DEEPSEEK.md`（项目级/用户级二选一，追加后 systemPrompt 热重载）
6. 内置命令补全：`/help` 分类展示、`/clear` 弹 y/N、`/compact` 真跑压缩、`/memory` 打开 memory、`/init` 生成骨架、`/resume` 会话切换
7. 快捷键映射对齐 Claude Code（↑↓ 双语义、Enter/Tab、Esc、Ctrl+C/D/L/A/E/U/W）
8. 状态栏（model / session / msgcount）

**Out of scope**

- MCP 命令面板（未来项）
- 文件系统 watcher（大仓库热更新，重启 REPL 才重扫）
- `!` 前缀 shell 片段展开（安全坑，后续再谈）
- Ctrl+R 会话反向搜索（预留按键）
- 插件系统命令（v0.4+）

## 段① 架构骨架

**当前问题的根源**：输入行 = readline，输出 = Ink；每次 `runTurn` 都新起一个 Ink 实例然后 unmount。切换过渡带来闪烁、光标错位；菜单只能被动展示。

**新架构：单一持久 Ink 实例贯穿整个 REPL。**

```
┌─ <App> (持久 mount) ─────────────────────────────┐
│  <History/>       ← 用 Ink <Static> 追加历史     │
│  <LiveStream/>    ← 当前 turn 的 streaming/tool  │
│  <StatusBar/>     ← model · session · msgcount   │
│  <InputBox>       ← 受控输入 + 弹出菜单           │
│    ├ 文本行（Ink 自绘，含光标、行编辑）           │
│    └ <SuggestionMenu/>（↑↓ 选中、Enter 提交）    │
└──────────────────────────────────────────────────┘
```

**关键机制**

1. **删除 readline**：`repl.ts` 里所有 `createInterface / emitKeypressEvents / SuggestionRenderer` 全部废弃。Ink 的 `useInput` 负责按键、光标、行编辑。
2. **Ink 只 mount 一次**：REPL 主循环变成"输入事件流 → 触发 runTurn → AgentEvent 写回 <History/> → 等下一次输入"。
3. **AgentEvent 消费复用**：把 `renderWithInk` 里的事件消费逻辑抽成 hook `useAgentStream(events, opts)`，`<LiveStream>` 与 `<History>` 共享同一状态源。
4. **持久 stdin**：Ink 直接接 `process.stdin`；用一个 mode flag 决定当前是"输入态"还是"跑 turn 态"，跑 turn 时禁用输入行按键 但允许 Esc 中止。

**新增模块**

- `packages/core/src/commands/` — types / loader / registry / parser
- `packages/core/src/memory/appender.ts` — 追加 memory 并热重载
- `packages/core/src/files/index.ts` — @file 补全的文件索引器
- `packages/cli/src/ui/InputBox.tsx`
- `packages/cli/src/ui/SuggestionMenu.tsx`
- `packages/cli/src/ui/AgentStream.tsx`（从当前 App 拆出）
- `packages/cli/src/ui/StatusBar.tsx`
- `packages/cli/src/ui/App.tsx` 重写为 shell
- `packages/cli/src/ui/hooks/useAgentStream.ts`
- `packages/cli/src/ui/hooks/useFuzzyMatch.ts`

**保留**：Session/Skills/Hooks/Provider/Permission/runTurn 主逻辑不动，仅重写 REPL/UI 层。

## 段② 命令模型 & 文件格式

**四类命令，统一路由**

| 类别 | 来源 | 优先级 | 例子 |
|---|---|---|---|
| Built-in | 代码里注册 | 最高 | `/help` `/model` `/clear` `/compact` `/sessions` `/config` `/quit` `/plan` `/memory` `/init` `/resume` |
| Project | `.deepseek-code/commands/*.md` | 中高 | `/deploy` `/review` |
| User | `~/.deepseek-code/commands/*.md` | 中 | `/pr` `/refactor` |
| Skill (command trigger) | Skill trigger=command | 低 | 兼容旧的 `/skills/<name>`；不撞名时也允许 `/name` 直触 |

同名冲突：built-in > project > user > skill。命令面板会显示类别标签。

**用户命令文件格式**（YAML frontmatter + body）：

```markdown
---
description: Create a PR with a smart summary
argument-hint: <base-branch>
allowed-tools: [Bash, Read, Grep]
model: deepseek-chat
---
你是一个善于写 PR 说明的助手。基分支：$1（默认 main）。
用户的额外说明：$ARGUMENTS
请：
1. `git diff $1...HEAD` 查看改动
2. 生成 title + summary + test plan
3. `gh pr create` 提交
```

- **frontmatter 字段**（全部 optional）：`description`, `argument-hint`, `allowed-tools`, `model`
- `description` 缺省时取 body 第一行
- 未知字段忽略但保留（前向兼容）

**占位符**

- `$1 $2 …` — 按空格切分的位置参数
- `$ARGUMENTS` — 命令后的所有原文
- 未匹配到占位符时保留字面（agent 可理解）

**命名空间**：子目录 → 冒号前缀。`commands/git/pr.md` → `/git:pr`（用 `:` 避开与 `@file` 里的 `/` 冲突）。

**执行语义**

1. Body 内做 frontmatter 变量替换
2. Body 内的 `@file` 引用被识别为附件（跟输入行同处理，见段④）
3. 组装完整 prompt 送入 agent；等价于用户在 REPL 手打这段文本
4. 若 frontmatter 有 `allowed-tools`，本 turn permission 引擎走临时白名单（其余工具 deny）
5. 若 frontmatter 有 `model`，本 turn 覆盖 currentModel（结束后恢复）

**内置命令改造**

- `/help` — 按类别分组展示
- `/clear` — Ink 弹 y/N 确认框，去掉 `--force` 语法
- `/compact` — 真调用 `compactMessages(...)`，显示 before/after 消息数
- `/plan` — 命令路由承接，`main.ts` 里嗅探 `/plan` 前缀的代码删除
- 新增 `/init` — 生成 `.deepseek-code/commands/` 骨架 + 示例文件
- 新增 `/memory` — 用户选择打开 project / user 的 `DEEPSEEK.md`（调 `$EDITOR`，无则 `less`）
- 新增 `/resume` — 弹会话列表，↑↓ 选中，Enter 切换（不退 REPL）

## 段③ 输入体验 & 快捷键

**`<InputBox>` 布局**

```
┌──────────────────────────────────────────────┐
│ > /mo█                                       │
├──────────────────────────────────────────────┤
│   /model      切换模型                        │  ← 高亮
│   /memory     编辑 DEEPSEEK.md                │
│   /mcp        MCP 服务器（未来）              │
└──────────────────────────────────────────────┘
      ↑↓ 选择 · Enter 提交 · Tab 补全 · Esc 关闭
```

**菜单触发**

| 触发符 | 弹什么 | 何时消失 |
|---|---|---|
| 空行 `/` | 命令面板（所有类别） | 空格进入参数区 或 Esc |
| `/xxx ` (含空格) | 参数提示（frontmatter 的 `argument-hint`），`/model` 弹模型列表 | Enter / Esc |
| `@` | 文件面板（git-tracked + cwd 兜底） | 光标离开 token 或 Esc |
| `#` | 提示"追加到 memory"；Enter 后弹选 project/user | Esc |
| 其它 | 无菜单 | — |

**模糊匹配**

- 打分器：fzy-lite（前缀权重 + subseq + 连续匹配奖励）
- 命令：先前缀过滤，再模糊排序
- 文件：`@src/i` 命中 `packages/**/src/**/index.ts`
- 命中字符区间用 cyan 高亮

**按键映射**

| 按键 | 无菜单时 | 菜单打开时 |
|---|---|---|
| ↑ / ↓ | 输入历史前后翻 | 移动高亮项 |
| Enter | 提交 turn | 补全选中项 → 光标停在参数位 |
| Tab | 无操作 | 同 Enter |
| Esc | 有 turn：中止；否则清空当前行 | 关闭菜单 |
| Ctrl+C | 同 Esc；连按两次退出 | 关闭菜单 |
| Ctrl+D | 空行时退出 | — |
| Ctrl+L | 清屏 | — |
| Ctrl+U/W | 删到行首 / 删单词 | 同 |
| Ctrl+A/E | 行首 / 行尾 | 同 |
| ← / → | 光标 | 光标 |

**关键行为**

- 菜单默认高亮第 0 项。`/` + Enter 直接执行第一个匹配 = "丝滑"最直观点
- 打字时菜单实时过滤，无闪烁（Ink diff 渲染）
- ↑ 翻历史时保留当前草稿；↓ 到底回到草稿
- `argument-hint` 显示为 dim 幽灵文本
- 已渲染历史用 Ink `<Static>` 只追加不重绘，长会话不卡

**状态栏（顶部或提示行右侧）**

```
model: deepseek-chat  ·  session: ab12cd  ·  msgs: 24  ·  esc to abort
```

## 段④ `@file` 与 `#memory`

### `@file` 引用

**文件索引**

- 有 `.git`：`git ls-files --cached --others --exclude-standard`（含 untracked、排除 gitignore）
- 无 `.git`：递归 readdir，硬编码跳过 `node_modules/ dist/ build/ .next/ coverage/ .cache/ .git/`
- 结果懒加载 + 内存缓存；不做 watch，重启 REPL 才重扫
- 超过 20k 文件时只前缀扫 + 增量模糊（保底）

**输入语法**

- `@` 触发菜单，紧邻其后连续非空白 = query
- 选中后 token 变成 `@<相对路径>`（保留字面 `@`）
- 一行内可多个 `@file`
- 支持 `@dir/`（目录）；`@file:10-40` 行范围留给未来

**Agent 侧处理**

- 提交前 InputBox 收集附件 → `attachments: string[]`
- `runTurn` 在 user message 前预置：
  ```
  [attached files]
  - packages/cli/src/repl.ts
  ```
- 不把内容塞 prompt（可能超长）；agent 需要时自己 Read。
- **不修改**"Edit 前必须 Read"规则；附件只是注意力提示

### `#memory` 追加

**语法**：`#` 开头的一整行；行内 `#` 不生效（避免误伤 Markdown）

**流程**

1. 用户输入 `#不要用 mock，测试要真跑数据库` + Enter
2. Ink 弹选择框：
   ```
   保存到：
   → 项目级  DEEPSEEK.md
     用户级  ~/.deepseek-code/DEEPSEEK.md
     取消
   ```
3. 选定后：
   - 文件不存在：创建 + header + 该行
   - 文件已存在：append 末尾（保留原格式）
   - 状态栏闪 `✓ 已追加到项目级 memory`（2s）
4. **热重载**：追加完调 `buildSystemPrompt` 重建 systemPrompt；下一 turn 生效，已发 turn 不受影响

**边界**

- 空 `#` 忽略
- >500 字符提示"建议直接编辑文件"，仍允许保存
- 不去重

## 段⑤ 迁移路径 & 兼容性

**破坏性变化**

- `repl.ts` 大规模重写；`SuggestionRenderer` 类删除；`createCompleter` 删除
- `ui/App.tsx` 重写为持久 shell；`renderWithInk` 签名变更（不再接一次性 events，改成 driver）
- `main.ts` 里 `input.startsWith('/plan')` 的字符串嗅探删除（改走命令路由）

**保持向后兼容**

- `/skills/<name>` 语法继续可用（skill command 依然通过它触发）
- 现有 `/help /model /config /plan /clear /sessions /compact /quit /cancel` 全部保留
- `DEEPSEEK.md` 位置、格式不变
- CLI 参数、子命令、`--resume` 等全部不变

**新增命令一览**

- `/memory` — 打开 memory 编辑器
- `/init` — 生成 commands 骨架
- `/resume` — 在 REPL 内切会话

**落地节奏**（Plan skill 会拆得更细）

1. Core 层先落地（commands / memory-append / file-index），零 UI 依赖，可独立测试
2. UI 层 InputBox / SuggestionMenu 独立组件 + 单元覆盖
3. App.tsx 重构 + REPL 持久化
4. 内置命令逐个迁移到路由
5. 手动 smoke test：从空 REPL 开始的 12 条常见操作路径
6. 更新 README 命令表 + 加一段 "用户命令" 章节

**测试策略**

- 单测：commands loader/parser、memory-appender、file-index、fuzzy 打分器
- 集成：命令路由（4 类冲突场景）、`@file` 附件注入、`#memory` 热重载
- 手动：REPL 交互（菜单键、闪烁、边界）— 无自动化 TUI 测试基建，人工过一遍

## 风险

1. **Ink `useInput` 与 Ink 输出交互**：跑 turn 时 InputBox 应"暂时禁用输入并显示 spinner"，但仍要接 Esc。用一个 `mode: 'idle' | 'running'` state 管理
2. **Windows 兼容**：Ink 在 Windows 上光标处理不同；本次优先 macOS + Linux，Windows 尽力
3. **大仓库文件索引**：20k+ 文件仓 fuzzy 打分慢；先做前缀 filter，再对前 500 条精排
4. **`allowed-tools` 权限白名单**：跟现有 PermissionEngine 交互需要小心；先走"临时 override"实现，turn 结束恢复原状
5. **命名空间冲突**：project 命令跟 built-in 撞名时不覆盖 built-in，但在面板里同时展示，标签区分——避免用户困惑

## 决定 log（brainstorming Q&A）

- Scope = 完整对齐 Claude Code（user 选）
- 命令 vs Skills = 开辟 commands 目录（auto-decided）
- @file 补全 = git-tracked 优先 + cwd 兜底（auto-decided）
- 输入引擎 = 全 Ink（auto-decided）
