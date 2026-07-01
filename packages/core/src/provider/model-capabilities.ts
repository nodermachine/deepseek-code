/**
 * @file 模型能力矩阵
 * 定义各 DeepSeek 模型的上下文窗口、工具调用支持、输出限制等能力
 * 用于 Agent Loop 中按模型动态调整行为（compact 阈值、R1 降级等）
 */

/** 单个模型的能力描述 */
export interface ModelCapability {
  /** 上下文窗口大小（token） */
  maxContext: number;
  /** 最大输出 token 数 */
  maxOutput: number;
  /** 是否支持工具调用 */
  toolCalls: boolean;
  /** 是否支持 thinking（推理链） */
  thinking: boolean;
  /** 是否支持并行工具调用（一次返回多个 tool_calls） */
  parallelToolCalls: boolean;
  /** 默认思考强度（仅 thinking=true 时有效） */
  defaultReasoningEffort?: 'low' | 'medium' | 'high';
}

/** 已知模型能力映射表 */
const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'deepseek-v4-flash': { maxContext: 1_000_000, maxOutput: 16_000, toolCalls: true, thinking: true, parallelToolCalls: true, defaultReasoningEffort: 'low' },
  'deepseek-v4-pro':   { maxContext: 1_000_000, maxOutput: 32_000, toolCalls: true, thinking: true, parallelToolCalls: true, defaultReasoningEffort: 'medium' },
  'deepseek-chat':     { maxContext: 64_000,    maxOutput: 8_000,  toolCalls: true,  thinking: false, parallelToolCalls: false },
  'deepseek-reasoner': { maxContext: 64_000,    maxOutput: 8_000,  toolCalls: false, thinking: true,  parallelToolCalls: false, defaultReasoningEffort: 'high' },
  'deepseek-coder':    { maxContext: 128_000,   maxOutput: 8_000,  toolCalls: true,  thinking: false, parallelToolCalls: false },
};

/** 默认能力（未知模型时使用） */
const DEFAULT_CAPABILITY: ModelCapability = {
  maxContext: 64_000,
  maxOutput: 8_000,
  toolCalls: true,
  thinking: false,
  parallelToolCalls: false,
};

/**
 * 获取指定模型的能力描述
 * 支持前缀匹配（如 'deepseek-reasoner-xxx' 匹配 'deepseek-reasoner'）
 */
export function getModelCapability(model: string): ModelCapability {
  // 精确匹配
  if (MODEL_CAPABILITIES[model]) return MODEL_CAPABILITIES[model];
  // 前缀匹配
  const matched = Object.keys(MODEL_CAPABILITIES).find(k => model.startsWith(k));
  return matched ? MODEL_CAPABILITIES[matched] : DEFAULT_CAPABILITY;
}

/**
 * 获取模型的上下文窗口大小
 */
export function getModelContextSize(model: string): number {
  return getModelCapability(model).maxContext;
}
