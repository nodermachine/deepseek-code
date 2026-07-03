/**
 * @file Sub-agent 执行器
 * 提供独立的子 agent 执行能力：继承父 session 的 readFiles，使用独立 messages，
 * 受限工具集，完成后返回文本结果。
 *
 * 设计参考 Claude Code AgentTool，但取 MVP：同步执行、只读默认、无 background/remote。
 */
import type { Provider } from '../provider/types.js';
import type { Session } from '../session/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Logger } from '../logger.js';
import type { AgentEvent } from '../types.js';
import { PermissionEngine } from '../permission/engine.js';
import { runAgentLoop } from './loop.js';
import { buildSubAgentPrompt } from '../prompts.js';
import { getModelCapability } from '../provider/model-capabilities.js';

/** 默认允许子 agent 使用的工具（只读） */
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];

/** Sub-agent 执行选项 */
export interface SubAgentOpts {
  /** 模型提供者 */
  provider: Provider;
  /** 父 session（继承 readFiles） */
  parentSession: Session;
  /** 子 agent 任务描述 */
  prompt: string;
  /** 模型选择，默认继承父 agent 使用的模型 */
  model?: string;
  /** 默认模型（当 model 未指定时使用） */
  defaultModel: string;
  /** 允许的工具列表，默认 ['Read', 'Grep', 'Glob', 'Bash'] */
  allowedTools?: string[];
  /** 最大步数，默认 15 */
  maxSteps?: number;
  /** 取消信号 */
  signal: AbortSignal;
  /** 日志器 */
  logger: Logger;
  /** 父 agent 的完整工具注册表（内部按 allowedTools 过滤） */
  registry: ToolRegistry;
}

/** Sub-agent 执行结果 */
export interface SubAgentResult {
  /** 是否成功完成 */
  ok: boolean;
  /** 子 agent 最终文本输出 */
  output: string;
  /** Token 消耗统计 */
  tokenUsage: { prompt_tokens: number; completion_tokens: number };
}

/**
 * 执行子 agent 任务
 *
 * 工作流程：
 * 1. 创建独立 Session（继承 readFiles，独立 messages）
 * 2. 过滤工具注册表（仅保留 allowedTools 中的工具）
 * 3. 构建子 agent 专属 system prompt
 * 4. 调用 runAgentLoop 执行
 * 5. 收集最终 assistant 文本作为结果返回
 */
export async function runSubAgent(opts: SubAgentOpts): Promise<SubAgentResult> {
  const {
    provider, parentSession, prompt, defaultModel,
    signal, logger, registry,
  } = opts;
  const model = opts.model ?? defaultModel;
  const allowedTools = opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const maxSteps = opts.maxSteps ?? 15;

  // 1. 创建独立 Session（继承 readFiles，messages 从空开始）
  const subSession: Session = {
    id: `sub-${Date.now().toString(36)}`,
    messages: [],
    readFiles: new Set(parentSession.readFiles), // 共享已读文件缓存
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    startedAt: new Date(),
    lastActiveAt: new Date(),
  };

  // 2. 过滤工具注册表：仅保留允许的工具
  const filteredRegistry = new ToolRegistry();
  for (const toolName of allowedTools) {
    const tool = registry.get(toolName);
    if (tool) filteredRegistry.register(tool);
  }

  // 3. 构建子 agent system prompt
  const systemPrompt = buildSubAgentPrompt(process.cwd());

  // 4. 权限引擎：子 agent 全局放行（已通过工具白名单限制）
  const permission = new PermissionEngine({
    globalRules: allowedTools.map(t => ({ tool: t, matcher: '*', decision: 'allow' as const })),
  });

  // 5. 执行 agent loop，收集事件
  let finalText = '';
  let doneReason: string = 'unknown';

  try {
    const events: AsyncIterable<AgentEvent> = runAgentLoop({
      provider,
      registry: filteredRegistry,
      permission,
      session: subSession,
      userInput: prompt,
      model,
      maxSteps,
      signal,
      logger,
      askPermission: async () => ({ decision: 'allow', remember: false }),
      systemPrompt,
    });

    for await (const ev of events) {
      switch (ev.type) {
        case 'text_delta':
          finalText += ev.text;
          break;
        case 'done':
          doneReason = ev.reason;
          break;
      }
    }
  } catch (e: any) {
    if (signal.aborted) {
      return { ok: false, output: '子 agent 被中断', tokenUsage: subSession.usage };
    }
    return { ok: false, output: `子 agent 执行失败: ${e.message}`, tokenUsage: subSession.usage };
  }

  // 6. 提取最终结果
  const ok = doneReason === 'natural';
  const output = finalText.trim() || (ok ? '(子 agent 未产生输出)' : `子 agent 异常结束: ${doneReason}`);

  // 将子 agent 的 readFiles 同步回父 session
  for (const f of subSession.readFiles) {
    parentSession.readFiles.add(f);
  }

  return {
    ok,
    output,
    tokenUsage: {
      prompt_tokens: subSession.usage.prompt_tokens,
      completion_tokens: subSession.usage.completion_tokens,
    },
  };
}
