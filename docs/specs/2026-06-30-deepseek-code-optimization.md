# deepseek-code DeepSeek V4 深度配合与代码优化建议

- **日期**：2026-06-30
- **作者**：deepseek-code 静态分析
- **状态**：Draft（待评审）
- **范围**：覆盖 `packages/core`、`packages/tools`、`packages/cli` 三包，聚焦与 DeepSeek V4 模型的深度配合、架构优化、代码质量提升

---

## 目录

1. [与 DeepSeek V4 模型深度配合](#1-与-deepseek-v4-模型深度配合)
2. [架构/设计优化](#2-架构设计优化)
3. [代码质量/性能优化](#3-代码质量性能优化)
4. [优先级汇总](#4-优先级汇总)
5. [实施建议](#5-实施建议)

---

## 1. 与 DeepSeek V4 模型深度配合

### 1.1 `model-capabilities.ts` — V4 模型参数不准确，缺少关键特性

**文件：** `packages/core/src/provider/model-capabilities.ts`

**当前现状：**

```ts
'deepseek-v4-flash': { maxContext: 64_000, maxOutput: 8_000, toolCalls: true, thinking: false },
'deepseek-v4-pro':   { maxContext: 64_000, maxOutput: 8_000, toolCalls: true, thinking: false },
```

**问题分析：**

| 字段 | 当前值 | V4 实际值 | 影响 |
|------|--------|-----------|------|
| `maxContext` | 64K | 1M (1,000,000) | compact 在 51K 就错误触发，浪费 V4 的大上下文 |
| `maxOutput` | 8K | 16K (Flash) / 32K (Pro) | 长代码生成被截断 |
| `thinking` | false | true（V4 原生深度思考） | reasoning_content 被解析但未被下游使用 |
| 缺失 `parallelToolCalls` | — | true | 模型能一次返回多个 tool_calls 但 loop 未利用 |

**优化建议：**

```ts
interface ModelCapability {
  maxContext: number;
  maxOutput: number;
  toolCalls: boolean;
  thinking: boolean;
  parallelToolCalls: boolean;  // 新增
}

const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'deepseek-v4-flash': { maxContext: 1_000_000, maxOutput: 16_000, toolCalls: true, thinking: true, parallelToolCalls: true },
  'deepseek-v4-pro':   { maxContext: 1_000_000, maxOutput: 32_000, toolCalls: true, thinking: true, parallelToolCalls: true },
  'deepseek-chat':     { maxContext: 64_000,    maxOutput: 8_000,  toolCalls: true,  thinking: false, parallelToolCalls: false },
  'deepseek-reasoner': { maxContext: 64_000,    maxOutput: 8_000,  toolCalls: false, thinking: true,  parallelToolCalls: false },
  'deepseek-coder':    { maxContext: 128_000,   maxOutput: 8_000,  toolCalls: true,  thinking: false, parallelToolCalls: false },
};
```

**涉及文件：**
- `packages/core/src/provider/model-capabilities.ts` — 数据修正
- `packages/core/src/types.ts` — 暂不需要改，但后续可能需要 `parallelToolCalls` 字段
- `packages/core/src/agent/loop.ts` — 消费 `parallelToolCalls` 能力

---

### 1.2 `deepseek.ts` Provider — 缺少 V4 API 关键参数传递

**文件：** `packages/core/src/provider/deepseek.ts`

**当前现状：**

```ts
const payload: Record<string, unknown> = {
  model: req.model,
  messages: req.messages,
  stream: true,
};
if (req.tools && req.tools.length > 0) {
  payload.tools = req.tools;
  payload.tool_choice = 'auto';
}
if (req.temperature !== undefined) {
  payload.temperature = req.temperature;
}
```

**问题分析：** DeepSeek V4 API 支持以下参数，当前均未传递：

| 参数 | 作用 | 建议 |
|------|------|------|
| `parallel_tool_calls` | 允许模型一次返回多个工具调用 | 当 `capability.parallelToolCalls` 为 true 时传 `true` |
| `max_tokens` | 限制输出长度 | 新增 `ChatRequest.maxTokens` 字段 |
| `stop` | 停止序列 | 新增 `ChatRequest.stop` 字段 |
| `top_p` | 核采样 | 低频使用，可暂不加 |
| `frequency_penalty` | 频率惩罚 | 低频使用，可暂不加 |

**优化建议：**

```ts
// provider/types.ts
export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;            // 新增
  parallelToolCalls?: boolean;   // 新增
  stop?: string[];               // 新增
}
```

```ts
// deepseek.ts stream() 方法
const payload: Record<string, unknown> = {
  model: req.model,
  messages: req.messages,
  stream: true,
};
if (req.tools && req.tools.length > 0) {
  payload.tools = req.tools;
  payload.tool_choice = 'auto';
}
if (req.temperature !== undefined) payload.temperature = req.temperature;
if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
if (req.parallelToolCalls !== undefined) payload.parallel_tool_calls = req.parallelToolCalls;
if (req.stop !== undefined) payload.stop = req.stop;
```

---

### 1.3 `loop.ts` — `isThinkingModel` 变量未使用 + reasoning 未做下游决策

**文件：** `packages/core/src/agent/loop.ts`

**当前现状（第 54 行）：**

```ts
const isThinkingModel = capability.thinking;
```

`isThinkingModel` 定义了但**从未被使用**，该变量可移除或在以下场景使用：

**优化建议：**

1. **移除未使用变量**（最小改动）：
   ```ts
   // 直接移除或注释
   ```

2. **利用 reasoning 做 compact 决策**（推荐）：
   ```ts
   // 在 loop 主循环中跟踪 thinking_delta 的总量
   let totalThinkingTokens = 0;
   // 在 case 'thinking_delta' 分支中累计
   case 'thinking_delta':
     totalThinkingTokens += estimateTokenCount(ev.text);
     yield { type: 'thinking_delta', text: ev.text };
     break;
   // 当 thinking 内容占用过多上下文时，在下轮 provider 调用时考虑压缩
   ```

3. **V4 模型输出时在 system prompt 中加入 reasoning 引导**（迁移到 `buildSystemPrompt`）：
   已在 `memory/loader.ts` 的 `buildSystemPrompt` 中做了，但 loop 中的 `isThinkingModel` 变量本身未被使用，说明 downstream 还没有消费这个信息。

**涉及文件：**
- `packages/core/src/agent/loop.ts`

---

### 1.4 `compact.ts` — V4 1M 上下文下压缩策略需要调整

**文件：** `packages/core/src/agent/compact.ts`

**当前现状：**

```ts
const DEFAULT_MAX_CONTEXT = 64000;
const DEFAULT_THRESHOLD_RATIO = 0.8;
const DEFAULT_KEEP_RECENT = 6;
```

V4 模型有 1M 上下文，80% 阈值意味 800K 才触发压缩，这合理。但 `estimateTokens()` 使用 `chars / 3` 的粗略估算对长文本误差大。

**问题分析：**

| 问题 | 描述 | 严重程度 |
|------|------|----------|
| Token 估算 | `chars / 3` 对中文偏差大（中文 1 token ≈ 1.5-2 chars，远低于英文） | 中 |
| 硬编码 fallback | `'deepseek-v4-flash'` 硬编码在第 131 行，不应写死 | 低 |
| V4 超大上下文 | 1M 下使用同样的 compact 模型可能浪费 token | 低 |

**优化建议：**

1. **改进 `estimateTokens`**：
   ```ts
   export function estimateTokens(messages: Message[]): number {
     let chars = 0;
     let chineseChars = 0;
     for (const m of messages) {
       if (m.content) {
         chars += m.content.length;
         // 粗略统计中文字符（Unicode CJK 范围）
         for (const ch of m.content) {
           if (ch >= '\u4e00' && ch <= '\u9fff') chineseChars++;
         }
       }
       if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
     }
     // 中文字符约 1.8 token/char，英文约 0.33 token/char
     const nonChinese = chars - chineseChars;
     return Math.ceil(chineseChars / 1.8 + nonChinese / 3);
   }
   ```

2. **移除非预期的硬编码**：`compact.ts` 第 131 行的 `'deepseek-v4-flash'` 已通过 `opts.compactModel` 覆盖，但 fallback 硬编码不优雅，可从 `DEFAULT_CONFIG.model` 获取。

---

### 1.5 `ToolRegistry.toSchemas()` — V4 对 JSON Schema 的兼容性

**文件：** `packages/core/src/tools/registry.ts`

**当前现状：**

```ts
const rawSchema = zodToJsonSchema(t.inputSchema, { target: 'openApi3' }) as Record<string, unknown>;
const cleaned = cleanSchema(rawSchema);
```

`cleanSchema` 已经做了 `$schema`、`$ref` 移除和 `exclusiveMinimum` 布尔值修复。V4 对 JSON Schema 的兼容性比 V3 更好，支持更丰富的描述。

**优化建议（可选）：**
- 考虑在 `function.description` 中包含工具的使用示例（V4 对示例敏感）
- 在 schema `properties` 的 `description` 字段中加入参数的中文说明，V4 能理解中文描述

---

## 2. 架构/设计优化

### 2.1 工具调用循环熔断逻辑可改进

**文件：** `packages/core/src/agent/loop.ts`（第 247-262 行）

**当前现状：**

```ts
if (step >= 3) {
  const recentToolMsgs = session.messages.filter(m => m.role === 'tool').slice(-6);
  if (recentToolMsgs.length >= 6) {
    const names = recentToolMsgs.map(m => m.name);
    const uniqueNames = new Set(names);
    if (uniqueNames.size <= 2) {
      session.messages.push({
        role: 'user',
        content: '[System] 检测到你在重复调用相同工具。请尝试不同的方法，或向用户报告当前进展和遇到的问题。',
      });
    }
  }
}
```

**问题分析：**

| 问题 | 说明 |
|------|------|
| 硬编码阈值 | `6` 次工具调用 + `3` 步才触发，对于 V4 可能太慢 |
| 中文提示 | V4 对英文指令更敏感，中文 prompt 效果可能打折扣 |
| 无退避 | 触发后下一轮模型可能继续循环，需要更结构化的熔断 |
| 无日志 | 熔断触发时只有 `logger.warn`，缺少可观测性 |

**优化建议：**

```ts
// 抽离为常量
const LOOP_DETECTION_MIN_STEP = 3;
const LOOP_DETECTION_TOOL_COUNT = 6;
const LOOP_DETECTION_UNIQUE_TOOL_LIMIT = 2;

// 熔断消息用英文（V4 对英文更敏感）
const BREAK_HINT_EN = '[System] Detected repeated tool calls. Please try a different approach or report progress to the user.';

// 在 session 中记录熔断次数，实现退避
let breakInjectionCount = 0;
// ...
if (step >= LOOP_DETECTION_MIN_STEP) {
  const recentToolMsgs = session.messages.filter(m => m.role === 'tool').slice(-LOOP_DETECTION_TOOL_COUNT);
  if (recentToolMsgs.length >= LOOP_DETECTION_TOOL_COUNT) {
    const names = recentToolMsgs.map(m => m.name);
    const uniqueNames = new Set(names);
    if (uniqueNames.size <= LOOP_DETECTION_UNIQUE_TOOL_LIMIT) {
      breakInjectionCount++;
      logger.warn('detected tool call loop, injecting break hint', { tools: [...uniqueNames], count: breakInjectionCount });
      // 随熔断次数增加提示强度
      const hint = breakInjectionCount > 2
        ? `${BREAK_HINT_EN} If the task cannot be completed with available tools, explain the limitation to the user.`
        : BREAK_HINT_EN;
      session.messages.push({ role: 'user', content: hint });
    }
  }
}
```

---

### 2.2 Hook 系统增加了复杂度但无实际钩子注册

**文件：** `packages/core/src/hooks/manager.ts`、`packages/core/src/hooks/types.ts` 及 `loop.ts` 中 6 处 hook 调用点

**当前现状：**

`loop.ts` 中有 6 个 hook 挂载点：
- `beforeProviderCall`（第 89 行）
- `afterProviderCall`（第 131 行）
- `onError`（第 122 行）
- `onDone`（第 144 行）
- `beforeToolExecute`（第 209 行）
- `afterToolExecute`（第 227 行）

但当前**没有任何组件注册这些 hooks**，所有 `hooks?.has()` 都返回 false，hook 调用成为纯空操作。

**优化建议（二选一）：**

1. **保留但加入默认行为**：在 CLI 层注册默认 hooks（如打日志、统计等）
2. **运行时检测**：在 `loop.ts` 中只调用一次 `if (hooks)` 而非 6 次 `?.has() + ?.run()`，减少异步调用开销

**折中方案：**

```ts
// 在 loop 入口集中判断一次
const hasHooks = !!hooks && (
  hooks.has('beforeProviderCall') ||
  hooks.has('afterProviderCall') ||
  hooks.has('onError') ||
  hooks.has('onDone') ||
  hooks.has('beforeToolExecute') ||
  hooks.has('afterToolExecute')
);

// 后续只在 hasHooks 为 true 时才检查
```

---

### 2.3 `ChatRequest` 接口未暴露给 Agent Loop 调用者

**文件：** `packages/core/src/provider/types.ts`、`packages/core/src/agent/loop.ts`

**当前现状：**

`runAgentLoop` 的 `model` 参数是字符串，传递给 provider 时调用者无法传递 `maxTokens`、`parallelToolCalls` 等新参数。

**优化建议：**

```ts
export interface RunAgentLoopOpts {
  // ... 现有字段
  model: string;
  /** 传递给 provider 的额外参数 */
  extraProviderParams?: {
    maxTokens?: number;
    parallelToolCalls?: boolean;
    stop?: string[];
  };
}
```

---

### 2.4 `ToolResult.recoverable` 字段在 Agent Loop 的 Provider 错误中未被利用

**文件：** `packages/core/src/agent/loop.ts`（第 117-128 行）、`packages/core/src/errors.ts`

**当前现状：**

Provider 异常时，`DeepseekCodeError` 包含 `recoverable` 字段，但 loop 中统一处理为 fatal：

```ts
catch (e: any) {
  yield { type: 'error', error: errorInfo };
  yield { type: 'done', reason: 'fatal' };
  return;
}
```

**优化建议：**

对于标记为 `recoverable` 的错误（如 429 Rate Limit），可以重试而不是立即 fatal：

```ts
let providerRetries = 0;
const MAX_PROVIDER_RETRIES = 1;

catch (e: any) {
  if (e.recoverable && providerRetries < MAX_PROVIDER_RETRIES) {
    providerRetries++;
    logger.warn('recoverable provider error, retrying', { error: e.code, retry: providerRetries });
    // 回到循环开头重试
    continue;
  }
  // 否则 fatal
}
```

---

## 3. 代码质量/性能优化

### 3.1 `DiskSessionStore` — 进程退出前未 flush，有数据丢失风险

**文件：** `packages/core/src/session/disk.ts`

**当前现状：**

`save()` 使用 debounce（默认 500ms）。如果用户在 500ms 内退出进程（Ctrl+C 或 SIGTERM），最近的会话状态会丢失。虽然 `flush()` 方法存在，但**不保证在进程退出前被调用**。

**优化建议：**

```ts
// disk.ts 增加进程退出处理
export class DiskSessionStore implements SessionStore {
  private static registered = false;

  constructor(opts: DiskSessionStoreOpts = {}) {
    // ... 现有逻辑
    if (!DiskSessionStore.registered) {
      DiskSessionStore.registered = true;
      const doFlush = () => {
        for (const [id, timer] of this.saveTimers) {
          clearTimeout(timer);
          // 注意：这里需要访问 session 数据，但 timer 闭包已捕获
        }
      };
      process.on('beforeExit', () => doFlush());
      process.on('SIGINT', () => { doFlush(); process.exit(0); });
      process.on('SIGTERM', () => { doFlush(); process.exit(0); });
    }
  }
}
```

> **注意**：`core` 包当前设计原则是不依赖 `node:process`，因此该优化应放在 `cli` 层实现，或在 `DiskSessionStore` 中通过构造函数注入退出回调。

### 3.2 Token 估算精度低

**文件：** `packages/core/src/agent/compact.ts`（第 32-39 行）

**当前现状：**

```ts
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    if (m.content) chars += m.content.length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 3);
}
```

`chars / 3` 对于中英混合场景（本项目的主要使用场景）误差可达 2-3 倍。

**优化建议（见 1.4 节）**，或引入简单的中文 token 估算：
```ts
// 更精确的估算
const chineseRatio = chineseChars / (chars || 1);
// 中文：约 1.8 chars/token；英文：约 4 chars/token
const effectiveRatio = 1.8 * chineseRatio + 4 * (1 - chineseRatio);
return Math.ceil(chars / effectiveRatio);
```

---

### 3.3 `loop.ts` — 未使用的 `isThinkingModel` 变量

**文件：** `packages/core/src/agent/loop.ts`（第 54 行）

**当前现状：**

```ts
const isThinkingModel = capability.thinking;
```

该变量声明后未被任何代码使用，应移除以避免 Lint 警告和读者困惑。

---

### 3.4 `Grep` 工具依赖外部 `rg` 二进制

**文件：** `packages/tools/src/grep.ts`

**当前现状：**

```ts
const res = spawnSync('rg', args, ...);
if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
  return { ok: false, error: 'ripgrep_not_installed', recoverable: false };
}
```

**问题：** macOS 默认未安装 ripgrep，用户首次使用时返回 `ripgrep_not_installed` 后没有安装引导。

**优化建议：**
```ts
if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
  return {
    ok: false,
    error: 'ripgrep_not_installed',
    recoverable: false,
    display: 'ripgrep 未安装，请运行 `brew install ripgrep`（macOS）或 `apt install ripgrep`（Linux）安装。作为替代，可使用 Bash find/grep 命令。',
  };
}
```

> 注意：`ToolResult` 类型当前没有 `display` 字段用于 `{ ok: false }` 的情况，如果要支持错误展示，需扩展类型。

---

### 3.5 `config.ts` — 三级配置的环境变量 `DEEPSEEK_` 前缀与模型名不一致

**文件：** `packages/core/src/config.ts`

**当前现状：**

环境变量使用 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 等前缀，但模型本身叫 **DeepSeek**（注意大小写），虽然这不影响功能，但与官方品牌名 `DeepSeek`（驼峰）不一致。

该项目自身也时而用 `deepseek` 小写，时而用 `DeepSeek` 驼峰。建议统一为小写 `deepseek-` 前缀以符合环境变量命名惯例（通常全大写 + 下划线）。

✅ **当前做法合理**，环境变量全大写是标准惯例，无需修改。

---

### 3.6 CLI 渲染层可能未充分利用 V4 的 streaming 能力

**尚未检查的文件：**
- `packages/cli/src/render/stream.ts`
- `packages/cli/src/render/format.ts`

**需确认：** V4 的 thinking_delta 是否被渲染为用户可见的推理过程（折叠/灰色文字展示），以及 tool_call_delta 是否被实时展示参数增量渲染。

---

## 4. 优先级汇总

| 优先级 | 领域 | 文件 | 建议 | 影响面 |
|--------|------|------|------|--------|
| 🔴 P0 | V4 模型参数 | `model-capabilities.ts` | 修正 V4 上下文窗口 64K→1M、输出限制、thinking 标志 | 核心正确性：compact 阈值、loop 行为 |
| 🔴 P0 | V4 模型能力 | `model-capabilities.ts` | 新增 `parallelToolCalls` 字段 | 性能：V4 多工具调用并行 |
| 🟠 P1 | Provider 参数 | `provider/types.ts` + `deepseek.ts` | 向 V4 API 传递 `parallel_tool_calls`、`max_tokens` 等 | 功能完整性 |
| 🟠 P1 | Agent Loop | `loop.ts` | 利用 `parallelToolCalls` 能力做决策 | 与 P0 联动 |
| 🟠 P1 | Agent Loop | `loop.ts` | 处理未使用变量 `isThinkingModel` | 代码整洁 |
| 🟠 P1 | Agent Loop | `loop.ts` | 利用 `recoverable` 错误字段做 provider 重试 | 鲁棒性 |
| 🟡 P2 | Compact | `compact.ts` | 改进中英文混排的 token 估算 | 准确性 |
| 🟡 P2 | Compact | `compact.ts` | V4 1M 上下文下压缩阈值调整为 90% | 性能 |
| 🟡 P2 | 循环熔断 | `loop.ts` | 使熔断提示更结构化、支持退避、用英文 | 用户体验 |
| 🟡 P2 | 会话持久化 | `disk.ts` | 进程退出前统一 flush | 数据安全 |
| 🟡 P2 | Tool 类型 | `tools/types.ts` | 允许 `{ ok: false }` 时带 `display` 信息 | 用户体验 |
| 🟢 P3 | Hook 系统 | `hooks/*` + `loop.ts` | 减少空 hook 调用开销，或注册默认 hook | 性能微优化 |
| 🟢 P3 | Grep 工具 | `grep.ts` | 安装引导信息 | 开发者体验 |
| 🟢 P3 | Token 估算 | `compact.ts` | 调用 DeepSeek API tokenize endpoint | 精确性（可选） |

---

## 5. 实施建议

### 5.1 实施顺序

```
Step 1: 修正 model-capabilities.ts 中 V4 模型数据（P0）
  → 影响 compact 阈值、loop 行为，必须先修

Step 2: 新增 parallelToolCalls 能力字段 + 暴露到 ChatRequest（P0）
  → 与 Step 1 紧耦合

Step 3: 在 loop.ts 中消费 parallelToolCalls + 利用 recoverable 错误（P1）
  → 依赖 Step 1-2

Step 4: 改进 compact.ts 估算 + 调整 V4 阈值（P2）
  → 依赖 Step 1

Step 5: 改进循环熔断 + 进程退出 flush（P2）
  → 独立，可并行

Step 6: 清理未使用变量 + Hook 系统优化（P3）
  → 独立，可并行
```

### 5.2 各步骤估计工作量

| 步骤 | 文件数 | 预计改动量 | 风险 |
|------|--------|-----------|------|
| Step 1 | 1 | 10 行 | 低 |
| Step 2 | 2 | 30 行 | 低 |
| Step 3 | 1 | 40 行 | 中（需确保回退兼容） |
| Step 4 | 1 | 20 行 | 低 |
| Step 5 | 2 | 30 行 | 中（退出信号处理需测试） |
| Step 6 | 3 | 20 行 | 低 |
