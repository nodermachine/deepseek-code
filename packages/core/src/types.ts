/**
 * @file 核心类型定义
 * 定义了消息、工具调用、Provider 事件、Agent 事件等基础类型
 */

/** 消息角色 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** OpenAI 兼容的消息结构 */
export interface Message {
  role: Role;
  content: string | null;
  /** assistant 消息中的工具调用列表 */
  tool_calls?: ToolCall[];
  /** tool 消息中关联的 tool_call id */
  tool_call_id?: string;
  /** tool 消息中的工具名称 */
  name?: string;
  /**
   * DeepSeek V4 的推理内容（thinking）
   * 当 assistant 消息包含 tool_calls 时，必须将 reasoning_content 回传给 API
   */
  reasoning_content?: string;
}

/** 单个工具调用描述 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** 传递给模型的工具 schema（OpenAI 兼容格式） */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object; // JSON Schema
  };
}

/** token 用量统计 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** DeepSeek Prompt Cache 命中的 token 数（计费为 miss 的 1/10） */
  prompt_cache_hit_tokens?: number;
  /** DeepSeek Prompt Cache 未命中的 token 数 */
  prompt_cache_miss_tokens?: number;
}

/**
 * Provider 层 SSE 流解析后产出的事件
 * - text_delta: 模型文本输出增量
 * - thinking_delta: R1 推理内容增量
 * - tool_call_delta: 工具调用参数增量
 * - tool_call_done: 单个工具调用参数解析完毕
 * - usage: token 用量
 * - finish: 流结束，附带终止原因
 */
export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_delta'; id: string; name?: string; argsDelta: string }
  | { type: 'tool_call_done'; id: string; name: string; args: unknown }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' };

/**
 * Agent loop 向调用者暴露的事件流
 * - text_delta/thinking_delta: 文本/推理内容，用于实时渲染
 * - tool_call_start/result: 工具调用开始/结果
 * - step_done: 一轮 loop 完成
 * - error: 可恢复或不可恢复错误
 * - done: loop 终止，附带原因
 */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string; input: unknown }
  | { type: 'tool_call_result'; id: string; result: ToolResultEnvelope }
  | { type: 'step_done'; step: number }
  | { type: 'error'; error: { code: string; userMessage: string } }
  | { type: 'done'; reason: 'natural' | 'max_steps' | 'abort' | 'fatal' };

/** 工具执行结果的统一信封，用于回喂模型 */
export interface ToolResultEnvelope {
  ok: boolean;
  output?: unknown;
  display?: string;
  error?: string;
}
