import type { Message, ToolSchema, ProviderEvent } from '../types.js';

/** thinking 模式控制 */
export interface ThinkingConfig {
  /** 是否启用 thinking（V4 flash/pro 支持 thinking + tool_calls 并行） */
  type: 'enabled' | 'disabled';
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 是否启用并行工具调用（V4 支持） */
  parallelToolCalls?: boolean;
  /** 停止序列 */
  stop?: string[];
  /** thinking 模式控制（V4 flash/pro 支持思考 + 工具调用并行） */
  thinking?: ThinkingConfig;
  /** 思考强度控制（仅 thinking.type='enabled' 时生效） */
  reasoning_effort?: 'low' | 'medium' | 'high';
}

export interface Provider {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
