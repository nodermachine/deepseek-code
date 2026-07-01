/**
 * @file Plan Mode
 * 两阶段执行模式：先让模型输出执行计划（不调工具），用户确认后再正常执行
 * 流程：planning phase → user confirm → execution phase
 */
import type { Provider } from '../provider/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionEngine } from '../permission/engine.js';
import type { Session } from '../session/types.js';
import type { Logger } from '../logger.js';
import type { AgentEvent } from '../types.js';
import type { PermissionRequest } from '../tools/types.js';
import type { AskPermissionResult } from './loop.js';
import { runAgentLoop } from './loop.js';

export interface PlanModeOpts {
  provider: Provider;
  registry: ToolRegistry;
  permission: PermissionEngine;
  session: Session;
  userInput: string;
  model: string;
  maxSteps: number;
  signal: AbortSignal;
  logger: Logger;
  askPermission: (req: PermissionRequest) => Promise<AskPermissionResult>;
  systemPrompt?: string;
  /** 用户确认回调：展示计划后等待用户输入 y/n/修改 */
  confirmPlan: (plan: string) => Promise<{ confirmed: boolean; modification?: string }>;
  /** 执行阶段使用的模型（默认同主模型，可用 flash 省成本） */
  planExecuteModel?: string;
}

/** Plan mode 追加的 system prompt 指令 */
const PLAN_INSTRUCTION = `

重要指令：你现在处于"规划模式"。
请先分析用户的需求，列出你的执行计划（编号步骤），说明每一步要做什么。
不要执行任何工具，不要开始实施。只输出计划文本。
等待用户确认后再执行。`;

/**
 * Plan Mode 执行器
 * 1. Planning phase: 调用模型生成计划（不带 tools）
 * 2. 等待用户确认
 * 3. Execution phase: 确认后带计划上下文执行正常 agent loop
 */
export async function* runPlanMode(opts: PlanModeOpts): AsyncGenerator<AgentEvent> {
  const { provider, session, userInput, model, signal, logger, confirmPlan, systemPrompt, planExecuteModel, ...rest } = opts;

  // === Phase 1: Planning ===
  // 注入 system prompt + plan 指令
  const planSystemPrompt = (systemPrompt ?? '') + PLAN_INSTRUCTION;
  if (!session.messages.some(m => m.role === 'system')) {
    session.messages.unshift({ role: 'system', content: planSystemPrompt });
  }

  session.messages.push({ role: 'user', content: userInput });

  // 调用模型，不带 tools（强制纯文本输出）
  let planText = '';
  try {
    for await (const ev of provider.stream({ model, messages: session.messages }, signal)) {
      if (ev.type === 'text_delta') {
        planText += ev.text;
        yield { type: 'text_delta', text: ev.text };
      }
      if (ev.type === 'thinking_delta') {
        yield { type: 'thinking_delta', text: ev.text };
      }
    }
  } catch (e: any) {
    yield { type: 'error', error: { code: e.code ?? 'PROVIDER_ERROR', userMessage: e.userMessage ?? e.message } };
    yield { type: 'done', reason: 'fatal' };
    return;
  }

  // 记录 assistant 的计划回复
  session.messages.push({ role: 'assistant', content: planText });
  yield { type: 'step_done', step: 0 };

  // === Phase 2: 等待确认 ===
  const { confirmed, modification } = await confirmPlan(planText);
  if (!confirmed) {
    yield { type: 'done', reason: 'natural' };
    return;
  }

  // === Phase 3: Execution ===
  // 移除 plan 指令，恢复正常 system prompt
  const sysIdx = session.messages.findIndex(m => m.role === 'system');
  if (sysIdx !== -1 && systemPrompt) {
    session.messages[sysIdx] = { role: 'system', content: systemPrompt };
  }

  // 用户确认消息（带上可能的修改指令）
  const confirmMsg = modification
    ? `请按计划执行，注意以下修改：${modification}`
    : '请按上述计划逐步执行。';

  // 进入正常 agent loop（执行阶段使用 planExecuteModel 或主模型）
  const execModel = planExecuteModel ?? model;
  const loopEvents = runAgentLoop({
    ...rest,
    provider,
    session,
    userInput: confirmMsg,
    model: execModel,
    signal,
    logger,
    systemPrompt, // 传正常 system prompt
  });

  for await (const ev of loopEvents) {
    yield ev;
  }
}
