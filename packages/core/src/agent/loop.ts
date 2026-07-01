/**
 * @file Agent Loop 核心状态机
 * 实现 "用户输入 → 模型推理 → 工具调用 → 循环" 的完整闭环
 * 阶段三新增：工具级并行执行（权限串行检查 → 执行并行）+ Skills 支持
 */
import type { Provider, ThinkingConfig } from '../provider/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionEngine } from '../permission/engine.js';
import type { Session } from '../session/types.js';
import type { Logger } from '../logger.js';
import type {
  AgentEvent, Message, ToolCall, ToolResultEnvelope,
} from '../types.js';
import type { PermissionRequest, Tool } from '../tools/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { Skill } from '../skills/types.js';
import type { HookManager } from '../hooks/manager.js';
import { getModelCapability } from '../provider/model-capabilities.js';

/** 用户对权限询问的应答结果 */
export interface AskPermissionResult { decision: 'allow' | 'deny'; remember: boolean }

export interface RunAgentLoopOpts {
  provider: Provider;           // 模型提供者
  registry: ToolRegistry;       // 工具注册表
  permission: PermissionEngine; // 权限引擎
  session: Session;             // 当前会话
  userInput: string;            // 用户输入
  model: string;                // 模型名称
  maxSteps: number;             // 最大循环步数，防失控
  signal: AbortSignal;          // 取消信号
  logger: Logger;               // 日志器
  askPermission: (req: PermissionRequest) => Promise<AskPermissionResult>; // 权限交互回调
  /** system prompt 内容（含 DEEPSEEK.md），首轮自动注入 */
  systemPrompt?: string;
  /** Skills 注册表（阶段三），用于 auto-trigger 关键词匹配 */
  skillRegistry?: SkillRegistry;
  /** Hooks 管理器（阶段三），事件钩子 */
  hooks?: HookManager;
  /** thinking 模式控制（V4 支持 thinking + tool_calls 并行） */
  thinking?: ThinkingConfig;
  /** 思考强度控制 */
  reasoning_effort?: 'low' | 'medium' | 'high';
}

/**
 * Agent Loop 核心函数
 * 工作流程：
 * 1. 将用户输入追加到 session messages
 * 2. 调用 provider 获取模型响应（流式）
 * 3. 若模型返回 tool_calls，串行执行各工具，结果回喂
 * 4. 重复 2-3 直到：自然结束 / max_steps / abort / fatal
 */
export async function* runAgentLoop(opts: RunAgentLoopOpts): AsyncGenerator<AgentEvent> {
  const { provider, registry, permission, session, userInput, model, maxSteps, signal, logger, askPermission, systemPrompt, hooks, thinking, reasoning_effort } = opts;
  const capability = getModelCapability(model);
  const supportsTools = capability.toolCalls;

  // 首轮注入 system prompt（如果 session 中还没有 system message）
  if (systemPrompt && !session.messages.some(m => m.role === 'system')) {
    session.messages.unshift({ role: 'system', content: systemPrompt });
  }

  // Skills auto-trigger：匹配用户输入中的关键词，注入匹配的 skill 内容
  let enrichedInput = userInput;
  if (opts.skillRegistry) {
    const matched = opts.skillRegistry.matchByKeywords(userInput);
    if (matched.length > 0) {
      const skillContext = matched.map((s: Skill) => `[Skill: ${s.name}]\n${s.content}`).join('\n\n');
      enrichedInput = `${userInput}\n\n---\n以下是相关技能上下文：\n${skillContext}`;
      logger.info('auto-trigger skills matched', { skills: matched.map((s: Skill) => s.name) });
    }
  }

  session.messages.push({ role: 'user', content: enrichedInput });
  let step = 0;
  let loopBreakCount = 0; // 循环熔断计数器

  // === 主循环：每轮调用一次模型，处理可能的工具调用 ===
  while (step < maxSteps) {
    if (signal.aborted) { yield { type: 'done', reason: 'abort' }; return; }
    step++;
    // 根据模型能力矩阵决定是否传工具 schema
    const tools = supportsTools ? registry.toSchemas() : undefined;
    if (!supportsTools && step === 1) logger.warn(`模型 ${model} 不支持工具调用，已自动降级`);

    // 累积本轮 assistant 的文本内容、推理内容和工具调用
    let assistantContent = '';
    let reasoningContent = ''; // V4 thinking 内容，有 tool_calls 时必须回传
    const pendingCalls = new Map<string, { name: string; args: unknown }>();
    let finishReason: 'stop' | 'tool_calls' | 'length' | null = null;

    // Hook: beforeProviderCall
    if (hooks?.has('beforeProviderCall')) {
      const aborted = await hooks.run('beforeProviderCall', session, { type: 'beforeProviderCall', messages: session.messages });
      if (aborted) { yield { type: 'done', reason: 'abort' }; return; }
    }

    try {
      for await (const ev of provider.stream({
        model,
        messages: session.messages,
        tools,
        maxTokens: capability.maxOutput,
        parallelToolCalls: capability.parallelToolCalls && tools !== undefined ? true : undefined,
        thinking: thinking ?? (capability.thinking ? { type: 'enabled' } : undefined),
        reasoning_effort: reasoning_effort ?? capability.defaultReasoningEffort,
      }, signal)) {
        switch (ev.type) {
          case 'text_delta':
            assistantContent += ev.text;
            yield { type: 'text_delta', text: ev.text };
            break;
          case 'thinking_delta':
            reasoningContent += ev.text;
            yield { type: 'thinking_delta', text: ev.text };
            break;
          case 'tool_call_done':
            pendingCalls.set(ev.id, { name: ev.name, args: ev.args });
            break;
          case 'usage':
            session.usage.prompt_tokens += ev.usage.prompt_tokens;
            session.usage.completion_tokens += ev.usage.completion_tokens;
            session.usage.total_tokens += ev.usage.total_tokens;
            // Prompt Cache 统计（DeepSeek V4 返回）
            if (ev.usage.prompt_cache_hit_tokens !== undefined) {
              session.usage.prompt_cache_hit_tokens = (session.usage.prompt_cache_hit_tokens ?? 0) + ev.usage.prompt_cache_hit_tokens;
            }
            if (ev.usage.prompt_cache_miss_tokens !== undefined) {
              session.usage.prompt_cache_miss_tokens = (session.usage.prompt_cache_miss_tokens ?? 0) + ev.usage.prompt_cache_miss_tokens;
            }
            break;
          case 'finish':
            finishReason = ev.reason;
            break;
        }
      }
    } catch (e: any) {
      // Provider 层报错：可能是网络/超时/服务异常
      if (signal.aborted) { yield { type: 'done', reason: 'abort' }; return; }
      // 可恢复错误（如 429 限流）重试一次
      if (e.recoverable && step <= maxSteps) {
        logger.warn('recoverable provider error, retrying', { code: e.code, step });
        step--; // 回退一步，下轮重试
        await new Promise(r => setTimeout(r, 1000)); // 等待 1s
        continue;
      }
      const errorInfo = { code: e.code ?? 'PROVIDER_ERROR', userMessage: e.userMessage ?? e.message };
      // Hook: onError
      if (hooks?.has('onError')) {
        await hooks.run('onError', session, { type: 'onError', error: errorInfo });
      }
      yield { type: 'error', error: errorInfo };
      yield { type: 'done', reason: 'fatal' };
      return;
    }

    // Hook: afterProviderCall
    if (hooks?.has('afterProviderCall')) {
      await hooks.run('afterProviderCall', session, {
        type: 'afterProviderCall', content: assistantContent, toolCallCount: pendingCalls.size,
      });
    }

    // --- 判断本轮结果 ---
    // 自然结束：模型没有发起工具调用
    if (!supportsTools || finishReason === 'stop' || pendingCalls.size === 0) {
      // thinking 内容不存入 session（自然结束时无需回传）
      if (assistantContent) session.messages.push({ role: 'assistant', content: assistantContent });
      yield { type: 'step_done', step };
      // Hook: onDone
      if (hooks?.has('onDone')) {
        await hooks.run('onDone', session, { type: 'onDone', reason: 'natural' });
      }
      yield { type: 'done', reason: 'natural' };
      return;
    }

    // 上下文溢出
    if (finishReason === 'length') {
      yield { type: 'error', error: { code: 'CONTEXT_EXHAUSTED', userMessage: '上下文已满，请开新会话' } };
      yield { type: 'done', reason: 'fatal' };
      return;
    }

    // --- 将工具调用记录到 session ---
    const toolCalls: ToolCall[] = [];
    for (const [id, c] of pendingCalls) {
      toolCalls.push({ id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } });
    }
    // V4: 有 tool_calls 时必须回传 reasoning_content（官方文档要求）
    const assistantMsg: Message = { role: 'assistant', content: assistantContent || null, tool_calls: toolCalls };
    if (reasoningContent) assistantMsg.reasoning_content = reasoningContent;
    session.messages.push(assistantMsg);

    // === 阶段一：串行权限检查，收集已授权的待执行列表 ===
    const authorized: Array<{ id: string; name: string; input: unknown; tool: Tool }> = [];

    for (const [id, c] of pendingCalls) {
      const tool = registry.get(c.name);
      // 未知工具：回喂错误让模型换路径
      if (!tool) {
        const env: ToolResultEnvelope = { ok: false, error: 'unknown_tool' };
        session.messages.push({ role: 'tool', content: JSON.stringify(env), tool_call_id: id, name: c.name });
        yield { type: 'tool_call_result', id, result: env };
        continue;
      }
      // 参数校验
      const parsed = tool.inputSchema.safeParse(c.args);
      if (!parsed.success) {
        const env: ToolResultEnvelope = { ok: false, error: `invalid_args: ${parsed.error.message}` };
        session.messages.push({ role: 'tool', content: JSON.stringify(env), tool_call_id: id, name: c.name });
        yield { type: 'tool_call_result', id, result: env };
        continue;
      }
      // 权限检查（串行，避免多个 ask 弹出混乱）
      yield { type: 'tool_call_start', id, name: c.name, input: parsed.data };
      const req = tool.needsPermission(parsed.data);
      if (req) {
        let decision = permission.check(req);
        if (decision === 'ask') {
          const res = await askPermission(req);
          decision = res.decision;
          if (res.remember) permission.remember(req, res.decision, 'session');
        }
        if (decision === 'deny' || decision === 'forbidden') {
          const env: ToolResultEnvelope = { ok: false, error: 'permission_denied' };
          session.messages.push({ role: 'tool', content: JSON.stringify(env), tool_call_id: id, name: c.name });
          yield { type: 'tool_call_result', id, result: env };
          continue;
        }
      }
      authorized.push({ id, name: c.name, input: parsed.data, tool });
    }

    // === 阶段二：并行执行所有已授权工具 ===
    if (authorized.length > 0) {
      const execPromises = authorized.map(async ({ id, name, input, tool }) => {
        // Hook: beforeToolExecute
        if (hooks?.has('beforeToolExecute')) {
          const aborted = await hooks.run('beforeToolExecute', session, {
            type: 'beforeToolExecute', toolName: name, toolId: id, input,
          });
          if (aborted) {
            return { id, name, result: { ok: false, error: 'hook_aborted' } as ToolResultEnvelope };
          }
        }

        let result: ToolResultEnvelope;
        try {
          const r = await tool.execute(input, { cwd: process.cwd(), signal, logger, session: { readFiles: session.readFiles } });
          result = r.ok ? { ok: true, output: r.output, display: r.display } : { ok: false, error: r.error };
        } catch (e: any) {
          result = { ok: false, error: e.message ?? 'execute_failed' };
        }

        // Hook: afterToolExecute
        if (hooks?.has('afterToolExecute')) {
          await hooks.run('afterToolExecute', session, {
            type: 'afterToolExecute', toolName: name, toolId: id, result,
          });
        }

        return { id, name, result };
      });

      const results = await Promise.all(execPromises);

      // 按原始顺序写入 session 并 yield 事件
      for (const { id, name, result } of results) {
        session.messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: id, name });
        yield { type: 'tool_call_result', id, result };
      }
    }

    yield { type: 'step_done', step };

    // === 异常行为检测：重复工具调用循环熔断 ===
    if (step >= 3) {
      const recentToolMsgs = session.messages.filter(m => m.role === 'tool').slice(-6);
      if (recentToolMsgs.length >= 6) {
        const names = recentToolMsgs.map(m => m.name);
        const uniqueNames = new Set(names);
        // 连续 6 次工具调用只有 1-2 种工具，判定为循环
        if (uniqueNames.size <= 2) {
          loopBreakCount++;
          logger.warn('detected tool call loop', { tools: [...uniqueNames], count: loopBreakCount });
          const hint = loopBreakCount > 2
            ? '[System] Detected repeated tool calls. If the task cannot be completed with available tools, explain the limitation to the user and stop.'
            : '[System] Detected repeated tool calls. Please try a different approach or report progress to the user.';
          session.messages.push({ role: 'user', content: hint });
        }
      }
    }
  }

  // Hook: onDone (max_steps)
  if (hooks?.has('onDone')) {
    await hooks.run('onDone', session, { type: 'onDone', reason: 'max_steps' });
  }
  yield { type: 'done', reason: 'max_steps' };
}
