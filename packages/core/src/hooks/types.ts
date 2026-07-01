/**
 * @file Hooks 类型定义
 * Hook 是 Agent Loop 的事件订阅/拦截机制
 * 支持在模型调用前后、工具执行前后注入自定义逻辑
 */
import type { AgentEvent, Message, ToolResultEnvelope } from '../types.js';
import type { Session } from '../session/types.js';

/** Hook 挂载点 */
export type HookPoint =
  | 'beforeProviderCall'   // 模型调用前（可修改 messages）
  | 'afterProviderCall'    // 模型调用后（收到完整响应）
  | 'beforeToolExecute'    // 工具执行前（可拦截）
  | 'afterToolExecute'     // 工具执行后（可修改结果）
  | 'onError'              // 错误发生时
  | 'onDone';              // loop 结束时

/** Hook 上下文，传递给 handler 的数据 */
export interface HookContext {
  /** 当前挂载点 */
  point: HookPoint;
  /** 当前会话 */
  session: Session;
  /** 相关数据（根据 point 不同而不同） */
  data: HookData;
  /** 调用此函数可中止当前操作 */
  abort: () => void;
  /** 是否已被中止 */
  aborted: boolean;
}

/** 各挂载点对应的数据类型 */
export type HookData =
  | { type: 'beforeProviderCall'; messages: Message[] }
  | { type: 'afterProviderCall'; content: string; toolCallCount: number }
  | { type: 'beforeToolExecute'; toolName: string; toolId: string; input: unknown }
  | { type: 'afterToolExecute'; toolName: string; toolId: string; result: ToolResultEnvelope }
  | { type: 'onError'; error: { code: string; userMessage: string } }
  | { type: 'onDone'; reason: string };

/** 单个 Hook 定义 */
export interface Hook {
  /** Hook 名称（用于调试和日志） */
  name: string;
  /** 挂载点 */
  point: HookPoint;
  /** 优先级，数字小的先执行（默认 100） */
  priority?: number;
  /** 处理函数 */
  handler: (ctx: HookContext) => Promise<void> | void;
}
