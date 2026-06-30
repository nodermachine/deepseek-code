# deepseek-code 设计文档（阶段一）

- **日期**：2026-06-30
- **作者**：Luna + 主人
- **状态**：Draft（待用户审阅）
- **范围**：阶段一 v0.1 骨架可用

## 0. 项目愿景

`deepseek-code` 是一款深度适配 DeepSeek 系列模型的命令行编码 Agent，对标 Claude Code + Claude 的组合形态。三阶段路线图分别交付：

| 阶段 | 版本 | 关键能力 | 时间预算 |
|---|---|---|---|
| 一 | v0.1 | 单 agent loop + DeepSeek 适配 + 5 个核心工具 + 三态权限 + 内存 session | 2-3 周 |
| 二 | v0.2 | Ink TUI + 多轮持久 session + 历史压缩 + Memory(DEEPSEEK.md) + Plan mode + Glob/WebFetch/TodoWrite | 3-4 周 |
| 三 | v0.3+ | Sub-agent 并行 + Skills + Hooks + MCP 客户端 + 三级配置 + plugin 包格式 | 开放式 |

本 spec 仅覆盖**阶段一**。阶段二、三留作后续 spec。

## 1. 阶段一目标与非目标

### 目标
- 让 DeepSeek（`deepseek-chat` 为主）能够在真实仓库里完成 **"读文件 → 改代码 → 跑测试 → 看输出 → 再改"** 的完整闭环。
- 工具调用安全可控，危险命令必须经用户确认。
- 核心运行时与 CLI 解耦，为阶段二、三的 TUI、Sub-agent、Skills 留下扩展点。
- 阶段一即建立 TDD 基础，覆盖率门槛 80%。

### 非目标（阶段一明确不做）
- TUI（沿用极简 readline REPL，Ink 留到阶段二）
- 历史压缩 / 多轮 compact
- Memory 文件加载（DEEPSEEK.md）
- Plan mode / TodoWrite
- Sub-agent / 并行 tool calls
- Skills / Hooks / MCP / Plugin 体系
- 真实 LLM 端到端 CI 测试

## 2. 关键设计抉择

| 维度 | 选择 | 理由 |
|---|---|---|
| 语言 / 运行时 | TypeScript 5+ / Node 20+ | 主人指定；CLI / TUI / MCP 生态成熟 |
| 包管理 | pnpm + workspace | 为阶段三 plugin 子包做铺垫 |
| 仓库形态 | monorepo（core / tools / cli） | core 解耦，未来 SDK / IDE 插件复用 |
| 模型抽象 | 薄 provider 接口，DeepSeek 实现优先，OpenAI 兼容口子保留 | 不绑死，方便 R1 限流时回落 V3 |
| 测试 | vitest，TDD，msw mock HTTP | 阶段一即建立质量基线 |
| 不引入 | langchain / mastra 等 agent 框架 | 保留对 DeepSeek 行为的完全掌控 |

## 3. 仓库结构

```
deepseek-code/
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/                     # 与 CLI 解耦的核心运行时
│   │   ├── src/
│   │   │   ├── agent/            # Agent loop、消息编排
│   │   │   ├── provider/         # 模型 provider 抽象 + DeepSeek 实现
│   │   │   ├── tools/            # 工具接口 + 工具注册表
│   │   │   ├── permission/       # 权限引擎
│   │   │   ├── session/          # 内存 session
│   │   │   ├── config/           # 配置加载
│   │   │   ├── logger/           # 结构化日志
│   │   │   └── index.ts
│   │   └── test/
│   ├── tools/                    # 5 个内置工具
│   │   └── src/{read,edit,write,bash,grep}.ts
│   └── cli/                      # 命令行入口（bin: deepseek-code）
│       ├── src/
│       │   ├── main.ts           # commander 解析
│       │   ├── repl.ts           # 极简 REPL（readline）
│       │   └── render/           # 流式渲染 + 工具调用展示
│       └── bin/deepseek-code
└── docs/
```

**模块边界规则**：

- `core` **不依赖** `cli`，CLI 提供的能力（stdin/stdout、readline、process）一律通过依赖注入传入。
- `tools` 依赖 `core` 的工具接口；工具之间**互不依赖**。
- `cli` 是唯一持有 process IO 的层。

**第三方依赖（阶段一允许）**：`commander`、`eventsource-parser`、`zod`、`picocolors`、`vitest`、`msw`。
**阶段一明令不引入**：langchain / mastra 等 agent 框架、Ink（推迟到阶段二）。

## 4. Agent loop

### 状态机

```
                ┌────────────────────────────────────┐
                ▼                                    │
   ┌─────────────────────┐                           │
   │ append user message │                           │
   └─────────┬───────────┘                           │
             ▼                                       │
   ┌─────────────────────┐                           │
   │ provider.stream(messages, tools)                │
   │  → SSE → assistant content + tool_calls         │
   └─────────┬───────────┘                           │
             ▼                                       │
   ┌─────────────────────┐                           │
   │ has tool_calls?     │── no ──▶ done / return ──┐│
   └─────────┬───────────┘                          ││
             │ yes                                  ││
             ▼                                      ││
   ┌─────────────────────┐                          ││
   │ for each tool_call: │                          ││
   │   permission check  │                          ││
   │   → run tool        │                          ││
   │   → append tool_result message                 ││
   └─────────┬───────────┘                          ││
             │                                      ││
             └──────────────────────────────────────┘│
                                                     │
   loop until: no tool_calls / max_steps / cancel ──┘
```

### 关键决定

| 项 | 决定 | 备注 |
|---|---|---|
| 多个 tool_calls | **串行**执行 | 阶段一不上并行；阶段三再做 |
| `max_steps` | 50 | 防失控；触顶 → 终止并提示用户拆分任务 |
| 取消 | 全链路 `AbortController` | CLI `SIGINT` → abort signal → provider 流断 + 工具中断 |
| 工具错误 | 包成 `tool_result: {ok:false, error}` 回喂模型 | 不终止 loop，让模型决定换路径 |
| 权限 deny | 同上 | 包成 tool_result 回喂 |
| Fatal 错误 | 终止 loop | 配置缺失、API key 无效、provider 401/403 |

### 流式事件

Agent loop 暴露 `onEvent(event)` 回调，事件类型：

```ts
type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }            // R1 reasoning_content
  | { type: "tool_call_start"; id: string; name: string; input: unknown }
  | { type: "tool_call_result"; id: string; result: ToolResult<unknown> }
  | { type: "step_done"; step: number }
  | { type: "error"; error: DeepseekCodeError }
  | { type: "done"; reason: "natural" | "max_steps" | "abort" | "fatal" };
```

CLI 据此渲染。

## 5. DeepSeek Provider 适配

### 接口

```ts
interface Provider {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}

interface ChatRequest {
  model: string;                  // "deepseek-chat" | "deepseek-reasoner"
  messages: Message[];
  tools?: ToolSchema[];
  temperature?: number;
}
```

### 实现要点

- **Endpoint**：`https://api.deepseek.com/v1/chat/completions`，`stream: true`，OpenAI 兼容
- **Auth**：`Authorization: Bearer <api_key>`
- **Function calling**：OpenAI 兼容 `tools` + `tool_choice: "auto"`；zod schema 转 JSON Schema
- **R1 (`deepseek-reasoner`)**：
  - 响应 `reasoning_content` 字段单独存在
  - **不能** 把 `reasoning_content` 塞回下一轮 messages（官方明确要求）
  - Provider 层分离为 `event: thinking_delta`，CLI 用折叠灰字展示
  - 后续轮次 messages 只回传 `content` + `tool_calls`
- **R1 function calling 支持状态**：截至本 spec 撰写时（2026-06），R1 对工具调用的支持仍不稳定/受限。
  - 阶段一默认 `deepseek-chat`
  - 用户显式选 R1 → 自动降级到"无工具"对话模式 + 警告
  - 实现前由开发者验证当下 R1 API 行为，若已稳定支持则可去掉降级逻辑（写入 v0.1 release note）
- **上下文**：V3 64K / R1 64K reasoning + 8K output；阶段一仅做硬截断保护（接近上限 → 报错让用户开新会话），不做 compact
- **重试**：429 / 5xx → 指数退避（最多 3 次，初始 1s，倍率 2，上限 8s）；网络错误同
- **SSE 解析**：`eventsource-parser`；中途断流 → 整轮重试一次（messages 不变）
- **Usage**：响应 `usage` 字段实时累加，阶段一只统计 token 数，不算钱

## 6. 工具系统

### 工具接口

```ts
interface Tool<I, O> {
  name: string;
  description: string;          // 给模型看的（一句话）
  inputSchema: z.ZodType<I>;
  needsPermission: (input: I) => PermissionRequest | null;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}

interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  logger: Logger;
}

type ToolResult<O> =
  | { ok: true; output: O; display?: string }
  | { ok: false; error: string; recoverable: boolean };
```

`ToolRegistry` 启动时收集所有工具，传给 provider 时序列化为 OpenAI 兼容 schema。

### 5 个内置工具

| 工具 | 行为 | 权限 |
|---|---|---|
| **Read** | 读绝对路径文件，cat -n 风格返回；默认 2000 行；支持 offset/limit；二进制拒绝 | 全部 allow |
| **Edit** | 精确字符串替换：`file_path` + `old_string` + `new_string`；`old_string` 必须在文件中唯一出现，否则返回 `ok:false, error:"non_unique_match"` 让模型扩大上下文重试；要求该路径已在本 session 内被 Read 过 | 首次写 ask（同 session 同绝对路径，后续 allow） |
| **Write** | 覆盖写整文件；要求已 Read 过（除非是新文件） | 首次写 ask |
| **Bash** | 执行 shell 命令；默认 30s 超时，可配；捕获 stdout+stderr+exitCode；`cwd` 强制为项目根 | 按命令"特征前缀" ask（见下） |
| **Grep** | ripgrep wrapper，支持 pattern / path / glob / `-i` / `-n` / context | 全部 allow |

**会话内"已读文件"追踪**：放在 `Session.readFiles: Set<string>`，Edit/Write 前查；写入后也更新（写完算读过）。

## 7. 权限引擎

### 规则数据结构

```ts
interface PermissionRule {
  tool: string;                     // "Bash" | "Edit" | "Write" | ...
  matcher: string;                  // 工具内部语义
  decision: "allow" | "deny" | "ask";
}
```

### 三层来源（优先级高 → 低）

1. **Session 内运行时记忆**（用户 ask 时选了 "allow for session" / "deny for session"）
2. **项目本地**：`.deepseek-code/permissions.json`
3. **用户全局**：`~/.deepseek-code/permissions.json`

### 默认规则

- `Read`、`Grep`：全部 allow
- `Edit`、`Write`：默认 ask，**按文件绝对路径**粒度记忆
- `Bash`：默认 ask，**按命令"特征前缀"** 粒度：
  - 已知子命令型工具列表（`git` / `npm` / `pnpm` / `yarn` / `pip` / `cargo` / `go` / `kubectl` / `docker` …）→ 取前两个 token，例 `git status -s` → 记 `git status`
  - 不在列表中 → 取第一个 token，例 `ls -la` → 记 `ls`
  - 同一前缀允许后续任意参数（不再 ask）
- **硬黑名单**（任何 ask 都不允许 allow，直接 deny）：`rm -rf /`、`sudo`、fork bomb `:(){ :|:& };:` 等明显危险模式

### ask 交互

```
[?] Bash wants to run: pnpm vitest run
    [a] allow once   [A] allow for session   [d] deny once   [D] deny for session
```

阶段一**不**做：path glob 编辑器、permission profile、远程同步。

## 8. Session、配置、CLI 入口

### Session

- 阶段一**仅内存**，进程结束即丢
- 数据结构：`{ id, messages, readFiles, permissionMemory, usage, startedAt }`
- 阶段二再做磁盘持久化（`~/.deepseek-code/sessions/<id>.json`）

### 配置

`~/.deepseek-code/config.json`（仅这一层，阶段一不做项目级）：

```json
{
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1",
  "bashTimeoutMs": 30000,
  "maxSteps": 50
}
```

启动时校验：缺 `apiKey` → 引导 `deepseek-code login`（最简形态：交互式粘贴）。

### CLI 入口

- `deepseek-code "<prompt>"`：单次任务模式，跑完即退
- `deepseek-code`（无参）：进入 REPL
- `deepseek-code login`：写入 apiKey
- `deepseek-code --version` / `--help`
- 通用 flag：`--model <name>`、`--debug`、`--cwd <path>`

REPL 极简：`readline`，单行输入，Ctrl+C 取消当前 turn，Ctrl+D 退出。

## 9. 错误处理

### 错误分层

| 层 | 错误类型 | 处理 |
|---|---|---|
| Provider | 网络 / 429 / 5xx | 指数退避重试 3 次 → 抛 `ProviderError` |
| Provider | 4xx（含 invalid key） | 立即抛，CLI 友好提示后退出 |
| Provider | SSE 中途断流 | 整轮重试一次（messages 不变） |
| Agent loop | 工具抛错 | 包成 `tool_result: {ok:false, error}` 喂回模型，**继续 loop** |
| Agent loop | 权限 deny | 同上 |
| Agent loop | `max_steps` 触顶 | 终止 loop，提示"任务过于复杂，建议拆分" |
| Agent loop | abort (Ctrl+C) | 立即 reject 进行中的 promise，CLI 回到提示符 |
| CLI | 配置缺失 | 启动时校验，缺 key → 引导 `deepseek-code login` |
| CLI | 未捕获异常 | 写 crash log → `~/.deepseek-code/logs/`，退出码 1 |

### 统一 Error 类型

```ts
class DeepseekCodeError extends Error {
  code: string;           // "PROVIDER_429" | "TOOL_TIMEOUT" | "PERMISSION_DENIED" ...
  recoverable: boolean;
  userMessage: string;    // 中文友好提示
  cause?: unknown;
}
```

## 10. 测试策略

### 金字塔

1. **单元（vitest，覆盖率门槛 80%）**
   - 每个工具：正常 + 边界 + 权限拒绝 + abort
   - 权限引擎：三层合并、Bash 前缀匹配、危险黑名单
   - Provider：SSE 解析、重试、R1 reasoning 分离（msw mock HTTP）

2. **集成（vitest，跑真实工具，不跑真实 LLM）**
   - Agent loop：注入 `FakeProvider`（脚本化返回 tool_calls / text）→ 验证完整流程
   - ~10 个固化场景：读改 typo / 命令失败重试 / 权限 deny 后换路径 / max_steps 触顶 / abort 中途取消 等

3. **端到端（手动 + CI smoke）**
   - CI 仅跑 `--version` / `--help` / mock provider 干跑
   - 真实 API 端到端在开发者本地按需跑，**不进 CI**（成本 + 不稳定）

### TDD 规则

- 新工具：先写失败测试 → 实现 → 通过
- 新 provider 行为：先 mock 响应 → 验证 loop 反应 → 实现解析

### 可观测性

- `--debug` 写 `~/.deepseek-code/logs/session-<id>.jsonl`：每条 message、每次工具调用、每次 SSE 事件
- 这条日志 = 排障唯一权威来源，bug 报告必带

## 11. 完成判据

阶段一 v0.1 视为完成当且仅当：

1. 在一个真实 TypeScript 仓库内，能让 `deepseek-chat` 完成 "读 README → 修 typo → 跑 vitest → 看输出" 闭环
2. 危险命令（`rm -rf foo`）会触发 ask 而非直接执行
3. Ctrl+C 能干净取消当前 turn 而不杀进程
4. 单元 + 集成测试覆盖率 ≥ 80%
5. `pnpm build && pnpm test` 在 CI 全绿
6. README 含安装、配置、最小示例

## 12. 阶段二、三预留口子

为避免阶段一做完阶段二要返工，阶段一即设计的扩展点：

| 阶段二/三需求 | 阶段一预留 |
|---|---|
| TUI（Ink） | Agent loop 通过 `onEvent` 回调暴露事件流，渲染层可替换 |
| 持久 session | `Session` 类已抽象，存储后端是接口（`MemorySessionStore`） |
| Compact | Agent loop 预留 `beforeProviderCall` hook 位 |
| Memory(DEEPSEEK.md) | Config loader 已分 user / project 层 |
| Plan mode / Todo | 工具注册表是动态的 |
| Sub-agent / 并行 | tool_call 执行点已经是数组循环，改并行只动一处 |
| Skills | 工具注册表 + provider 描述拼接已抽离 |
| Hooks | Agent loop 已有事件流，hook 是事件订阅者 |
| MCP | Provider 是接口，MCP server 可视作动态工具源 |

## 13. 待用户决策（写完 spec 后剩余的小事）

无。所有关键抉择已在本 spec 中固化。
