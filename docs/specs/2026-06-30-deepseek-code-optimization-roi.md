# deepseek-code 优化建议（ROI 排序版）

- **日期**：2026-06-30
- **作者**：Luna（对话式调研产出）
- **状态**：Draft
- **范围**：聚焦 DeepSeek 模型深度配合 + 项目层面高 ROI 改动
- **关联文档**：
  - [`2026-06-30-deepseek-code-optimization.md`](./2026-06-30-deepseek-code-optimization.md)（全面静态分析版，互补阅读）
  - [`grow.md`](./grow.md)（v0.3 进化方向）
  - [`2026-06-30-deepseek-code-phase1-design.md`](./2026-06-30-deepseek-code-phase1-design.md)（阶段一设计）

> 与前一份"优化建议"文档的区别：前者重在**问题清单全面性**；本文按**ROI 排序**、补充了若干前文未覆盖的发现（prompt cache 采集、FIM、JSON mode、bash 沙箱、abort 半截 thinking、SIGINT flush 等），并给出**两小时可落地的执行顺序**。

---

## 目录

1. [DeepSeek 深度优化（最高 ROI）](#一deepseek-深度优化最高-roi)
2. [项目层面（与 DeepSeek 弱相关）](#二项目层面与-deepseek-弱相关但-roi-高)
3. [建议执行顺序](#三建议执行顺序)
4. [验证清单](#四验证清单)

---

## 一、DeepSeek 深度优化（最高 ROI）

### 1. 🔴 默认模型名疑似无效 — 必须先校准

`packages/core/src/config.ts:16` 默认 `deepseek-v4-flash`，`model-capabilities.ts:23-24` 也按 `v4-flash/v4-pro` 登记（1M 上下文、thinking、parallelToolCalls）。但 DeepSeek 官方目前公开发布的模型是 `deepseek-chat / deepseek-reasoner / deepseek-coder`（V3 系列）。

**风险**：如果 `v4-*` 是占位/前瞻名称，全新用户开箱即收到 `model not found` 400。

**行动**：
- 用真实 API key 拉一次 `GET /models` 校验；
- 若不存在，将默认改回 `deepseek-chat`，把 v4 行注释为"前瞻保留"或删除；
- 同时修复 README 与代码默认值不一致（README 写 `deepseek-chat`、代码默认 `deepseek-v4-flash`）。

---

### 2. 🔴 采集并展示 Prompt Cache 命中率 — 一次改动节省最高 70% 成本

DeepSeek `chat/completions` 的 `usage` 会返回 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，命中 token 的计费是 miss 的 **1/10**。

**现状**：`provider/deepseek.ts:127,161` 透传了完整 `chunk.usage`，但 `agent/loop.ts:108-110` 只累加 `prompt_tokens / completion_tokens / total_tokens`，**Cache 字段被丢弃**。

**行动**：
- `core/src/types.ts` 的 `Usage` 加 `prompt_cache_hit_tokens?: number` / `prompt_cache_miss_tokens?: number`；
- `loop.ts` 累加这两个字段；
- REPL 状态栏展示 `cache hit: 87%`（呼应 grow.md 的可观测性方向）；
- 同时验证 system prompt 构造是否"前缀稳定"——见 #3。

---

### 3. 🔴 让 Prompt Cache 真的能命中 — 修 prefix 不稳定的两处

DeepSeek prompt cache 是**前缀匹配**，命中要求 prefix 完全一致。当前代码有两处会破坏稳定性：

#### 3.1 `memory/loader.ts: buildSystemPrompt` 时间/git 类易变内容

把 `cwd` 写进 system 没问题（同会话内稳定）。但如果后续加入"当前时间 / git HEAD / 随机 hint"会立刻刷掉缓存。

**行动**：约定 system 段**只承载稳定内容**（model hint / DEEPSEEK.md / always-on skills），易变内容下沉到 user 第一条。

#### 3.2 `loop.ts:60-69` auto-trigger skill 拼到 user 末尾

不会污染 system 前缀，但 user 段每轮变化会让 user 段无法被缓存（缓存是序列前缀算的）。

**行动**：
- always-on skills 在 system 段**按字母排序**注入（而不是 `fs.readdir` 返回顺序），保证多次启动一致；
- auto-trigger skill 缩短到 200 tokens 以内，或迁移到 tool-result 风格的辅助消息位置。

---

### 4. 🔴 capability 已定义但只消费了 toolCalls

`getModelCapability(model)` 在 `loop.ts:52` 调用了，但只用了 `capability.toolCalls`。`maxOutput / parallelToolCalls` 全程没传给 provider：

```ts
// loop.ts:95 现状
provider.stream({ model, messages: session.messages, tools }, signal)
```

**行动**：

```ts
provider.stream({
  model,
  messages: session.messages,
  tools,
  maxTokens: capability.maxOutput,
  parallelToolCalls: capability.parallelToolCalls && tools !== undefined,
  temperature: opts.temperature ?? 0.0,   // 编码任务默认 0
}, signal)
```

补充说明：
- 编码场景 `temperature` 默认改 **0.0**（DeepSeek 推荐 0~0.2），把它暴露成 `config.temperature`；
- `deepseek-reasoner` (R1) 官方明确说 **temperature / top_p / presence_penalty 全部被忽略**，且 toolCalls 已关，给它单独走"裸 stream + 不传 stop"的分支；
- `chat` 是否真的不支持 `parallel_tool_calls` 需要灰度验证（见 #10）。

---

### 5. 🟠 工具参数非法 JSON 不该 fatal — 应回喂让模型自修复

`provider/deepseek.ts:151-157`：参数 `JSON.parse` 失败直接抛 `PROVIDER_TOOL_ARGS_INVALID` → `loop.ts:117` fatal → 用户本轮 token 全部白花。

但模型有约 1% 概率输出半截 JSON（尤其多工具并行时）。

**行动**：把这次 tool_call 在 session 里写成 assistant，然后追加一条 `role:'tool'` 内容：
```json
{ "ok": false, "error": "invalid_json: <raw>" }
```
让模型下一轮自修复。loop.ts:173-191 已经为"未知工具 / invalid_args"做了这套，照抄即可。

---

### 6. 🟠 接入 FIM（Fill-in-the-Middle）让 Edit 真正擅长插入

`deepseek-coder` 的 `/beta/completions` FIM 接口是它最强的卖点：给 `prompt`（前文）+ `suffix`（后文），模型只补中间。

**痛点**：当前 `Edit` 工具是"精确字符串替换 + old_string 必须唯一"，对长文件做"在某个函数中间插入一段代码"经常匹配失败。

**行动**：新增 `Insert(file, anchor, content)` 或 `Complete(file, cursor)` 工具，走：

```http
POST /beta/completions
{
  "model": "deepseek-coder",
  "prompt": "<前文>",
  "suffix": "<后文>",
  "max_tokens": 256,
  "stop": ["\n\n"]
}
```

- 工具仅在 `model.startsWith('deepseek-coder')` 时注册到 ToolRegistry，避免给 chat 模型用；
- 单独解决"长文件改不动"的常见痛点。

---

### 7. 🟠 JSON Mode / 结构化输出

DeepSeek 支持 `response_format: { type: 'json_object' }`。当前 `ChatRequest` 没有这个字段。

**痛点**：plan-mode、compact 摘要等场景要求严格 JSON 输出，目前靠 prompt 约束，模型偶尔会把 markdown 代码块写出来，需要 regex 提取。

**行动**：`ChatRequest` 加 `responseFormat?: 'json_object'`；`compact.ts` 调摘要时启用；摘要输出 `JSON.parse` 直接消费，省掉一层正则提取。

---

### 8. 🟠 R1 (deepseek-reasoner) thinking 链与 abort 的相互作用

`loop.ts:148` 注释正确："thinking 内容不存入 session（官方要求不可回传）"。

**新发现**：abort 时 `main.ts:188-193` 只 pop 末尾空 assistant 消息。但如果中断时 R1 已经输出了一部分 `reasoning_content` 但还没有 `content`、也没有 tool_call_done，session 里会有一个空 assistant；下一轮调用时模型会重新思考，**而前一条 user 已经被消费**。

**行动**：abort 时如果 assistant 没有 content 也没有 tool_calls，连同前一条 user 一并 pop，让用户重发。

---

### 9. 🟢 摘要降级太弱

`compact.ts:151` 摘要失败时只塞 `"[历史摘要] 之前的对话包含 N 条消息..."`，等于把上下文删了又骗模型说"有"。

**行动**：降级时结构化提取本地可拿到的信号 → 拼成一段：
- 最近 read 过哪些文件（`session.readFiles`）；
- 最近 5 次工具调用名 + 简短结果；
- 用户最初 prompt 原文。

---

### 10. 🟢 `parallel_tool_calls` 灰度策略

能力表标 `v4` 支持、`chat` 不支持。DeepSeek 这个参数在不同版本有时是 *请求被静默接受但实际只回一个*。

**行动**：先**采集**——每次 finish 时 log `tool_calls.length`，跑一周后再决定要不要给 `chat` 也打开。

---

## 二、项目层面（与 DeepSeek 弱相关，但 ROI 高）

### A. 🔴 测试覆盖率与核心模块裸奔

- `vitest.config.ts` 设了 80% 阈值，实测 `coverage/index.html` **statements 62.59%**。CI 要么没跑 coverage gate，要么 gate 被忽略 → **先让 CI 红，再补测**；
- `provider/deepseek.ts`、`provider/sse.ts`、`agent/plan-mode.ts`、`mcp/tool-adapter.ts`、`tools/{grep,glob,write,web-fetch,todo-write}` **一个单测都没有**；
- devDependencies 里有 `msw` 但没用 → 用 msw 给 deepseek provider 写 SSE 重放测试是性价比最高的补救。

### B. 🔴 TodoWrite 用 module 全局 — 并行会话互污

`packages/tools/src/todo-write.ts:32` `let globalTodos: TodoItem[] = []`。grow.md 阶段四 Task 3 已识别过这个，照着改：挂到 `ctx.session.todos`。

### C. 🟠 DiskSessionStore 写盘阻塞 + 无 SIGINT flush

- `session/disk.ts:130` 用 `writeFileSync`，大 session（>1MB）会阻塞 Event Loop，TUI 表现成"卡顿一下"。改 `fs.promises.writeFile` 写临时文件再 `rename` 原子化；
- `main.ts:201` 只注册了 `process.on('exit')`，Ctrl+C / SIGTERM 会丢失最近 500ms 的 debounce 写入。补 SIGINT/SIGTERM 同步 flush。

### D. 🟠 Bash 工具沙箱

`tools/src/bash.ts` `spawn('bash', ['-c', cmd])` + 黑名单。黑名单是"反列表"，永远追不上新姿势。至少加：
- `cwd` 限制在 `session.cwd` 子树（拒绝 `cd /` 类越界）；
- `env` 白名单透传，不要直接继承全 `process.env`（**API key 会泄漏给子命令**）。

### E. 🟠 config.ts 项目级 JSON 解析失败静默吞

`config.ts:102` `catch {}` → 用户改坏 `.deepseek-code/config.json` 后表现为"配置全失效"，无 warn。至少 `logger.warn`。

### F. 🟢 webFetch 用正则去标签

对 SPA 几乎拿不到正文。要么接 readability/cheerio，要么和 skills 里的 web-fetch (playwright) 打通：检测到 `<div id="root">` 空壳就降级到 skill。

### G. 🟢 缺 `/cost` 命令

`session.usage` 累加好了但没暴露给 REPL。加个 `/cost` 显示当前 token 数 × DeepSeek 价目表（cache hit/miss 分别算）= 实际 USD。配合优化 #2，cache 命中率有了肉眼可见的反馈。

---

## 三、建议执行顺序

| 顺序 | 任务 | 工作量 | 关联 |
|---|---|---|---|
| 1 | 校准 DeepSeek 模型名 | 30 分钟 | #1 |
| 2 | 采集 cache hit/miss + `/cost` 命令 | 1 小时 | #2 / G |
| 3 | capability 真正消费 + temperature 落 0 | 1 小时 | #4 |
| 4 | invalid JSON 不 fatal（回喂自修复） | 30 分钟 | #5 |
| 5 | provider/deepseek msw 单测 | 半天 | A |
| 6 | TodoWrite 迁移到 session + Disk 原子写 + SIGINT flush | 半天 | B / C |
| 7 | FIM 工具（deepseek-coder 专属） | 1 天 | #6 |
| 8 | JSON mode + 摘要硬化 + abort 半截 thinking | 半天 | #7 / #8 / #9 |

**两小时即可拿到的最大 ROI**：1 + 2 + 4。

---

## 四、验证清单

每项落地后必须验证：

- [ ] **#1** 默认模型：用真实 key 跑 `pnpm dev`，发"你好"能收到流式响应；
- [ ] **#2** Cache 字段：连续两次发一模一样的 system prompt + user，第二次 `prompt_cache_hit_tokens` > 0；
- [ ] **#3** Prefix 稳定：跨进程冷启动后，第一次请求 cache hit 仍 > 0（说明 prefix 完全一致）；
- [ ] **#4** capability 消费：在 `payload.max_tokens` 处打日志确认值等于能力表；
- [ ] **#5** 自修复：mock 返回半截 JSON args，确认 loop 没 fatal，下一轮模型重出；
- [ ] **#6** FIM：对 100 行函数中插入一行，对比 Edit 工具失败率；
- [ ] **#7** JSON mode：compact 摘要在 mock 模型故意输出 markdown 包裹的 JSON 时，仍能 parse 成功；
- [ ] **A** msw 测试：CI coverage gate 跑红一次再跑绿。

---

## 附：本文未覆盖（详见前序文档）

- 全面的代码静态分析问题清单 → 见 [`2026-06-30-deepseek-code-optimization.md`](./2026-06-30-deepseek-code-optimization.md)
- 多 Agent 编排 / 结构化记忆 / 动态工具发现 → 见 [`grow.md`](./grow.md)
- 阶段一架构与边界 → 见 [`2026-06-30-deepseek-code-phase1-design.md`](./2026-06-30-deepseek-code-phase1-design.md)
