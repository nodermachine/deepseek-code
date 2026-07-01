import type { Message, ToolSchema, ProviderEvent } from '../types.js';

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
}

export interface Provider {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
