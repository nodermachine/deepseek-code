/**
 * @file 成本追踪器
 * 按模型统计 token 消耗并计算 USD 成本。支持会话级持久化。
 *
 * 参考 Claude Code cost-tracker.ts（324行），取务实 MVP：
 * - 按模型分账（input/output/cache_hit）
 * - DeepSeek 定价表
 * - JSON 序列化/反序列化
 * - 格式化展示
 */
import type { Usage } from '../types.js';

// ============================================================
// DeepSeek 定价表（USD per 1M tokens）
// 来源: https://platform.deepseek.com/api-docs/pricing
// ============================================================

/** 模型定价（每百万 token 的 USD 价格） */
export interface ModelPricing {
  /** 输入 token 单价 */
  input: number;
  /** 输出 token 单价 */
  output: number;
  /** 缓存命中单价（通常为 input 的 1/10） */
  cacheHit: number;
}

/** DeepSeek 各模型定价表 */
const PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-flash': { input: 0.14, output: 2.19, cacheHit: 0.014 },
  'deepseek-chat': { input: 0.14, output: 2.19, cacheHit: 0.014 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheHit: 0.055 },
};

/** 获取模型定价，未知模型使用 flash 定价作为 fallback */
function getPricing(model: string): ModelPricing {
  // 尝试精确匹配，再尝试前缀匹配
  if (PRICING[model]) return PRICING[model];
  for (const [key, val] of Object.entries(PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return PRICING['deepseek-v4-flash']; // fallback
}

// ============================================================
// 单模型统计
// ============================================================

/** 单模型的 token 消耗记录 */
export interface ModelUsage {
  /** 输入 token 总量（含缓存命中） */
  promptTokens: number;
  /** 输出 token 总量 */
  completionTokens: number;
  /** 缓存命中 token 数 */
  cacheHitTokens: number;
  /** API 调用次数 */
  requests: number;
}

// ============================================================
// CostTracker 主类
// ============================================================

/** 持久化格式 */
export interface CostTrackerData {
  models: Record<string, ModelUsage>;
  startedAt: string;
  lastUpdatedAt: string;
}

/**
 * 成本追踪器
 * 按模型统计 token 消耗，计算 USD 成本，支持序列化/反序列化。
 */
export class CostTracker {
  private models: Map<string, ModelUsage> = new Map();
  private startedAt: Date;
  private lastUpdatedAt: Date;

  constructor() {
    this.startedAt = new Date();
    this.lastUpdatedAt = new Date();
  }

  /** 记录一次 API 调用的 token 消耗 */
  record(model: string, usage: Usage): void {
    const existing = this.models.get(model) ?? {
      promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, requests: 0,
    };
    existing.promptTokens += usage.prompt_tokens;
    existing.completionTokens += usage.completion_tokens;
    existing.cacheHitTokens += (usage.prompt_cache_hit_tokens ?? 0);
    existing.requests += 1;
    this.models.set(model, existing);
    this.lastUpdatedAt = new Date();
  }

  /** 计算单模型 USD 成本 */
  modelCost(model: string): number {
    const u = this.models.get(model);
    if (!u) return 0;
    const p = getPricing(model);
    const inputNonCached = u.promptTokens - u.cacheHitTokens;
    const inputCost = (inputNonCached * p.input + u.cacheHitTokens * p.cacheHit) / 1_000_000;
    const outputCost = (u.completionTokens * p.output) / 1_000_000;
    return inputCost + outputCost;
  }

  /** 计算总 USD 成本 */
  totalCost(): number {
    let total = 0;
    for (const model of this.models.keys()) {
      total += this.modelCost(model);
    }
    return total;
  }

  /** 获取总 token 数 */
  totalTokens(): number {
    let total = 0;
    for (const u of this.models.values()) {
      total += u.promptTokens + u.completionTokens;
    }
    return total;
  }

  /** 获取总体缓存命中率 */
  cacheRate(): number {
    let totalPrompt = 0;
    let totalHit = 0;
    for (const u of this.models.values()) {
      totalPrompt += u.promptTokens;
      totalHit += u.cacheHitTokens;
    }
    return totalPrompt > 0 ? Math.round(totalHit / totalPrompt * 100) : 0;
  }

  /** 格式化成本为 USD 字符串 */
  formatCost(): string {
    const cost = this.totalCost();
    return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
  }

  /** 生成单行摘要（用于状态栏） */
  summary(): string {
    const tokens = this.totalTokens();
    if (tokens === 0) return '';
    return `tokens: ${tokens.toLocaleString()} | ${this.formatCost()} | cache: ${this.cacheRate()}%`;
  }

  /** 生成详细报告（用于 /usage 命令） */
  report(): string {
    if (this.models.size === 0) return '暂无 token 消耗记录';
    const lines: string[] = ['模型成本明细：', ''];
    for (const [model, u] of this.models) {
      const cost = this.modelCost(model);
      const cacheRate = u.promptTokens > 0 ? Math.round(u.cacheHitTokens / u.promptTokens * 100) : 0;
      lines.push(`  ${model}`);
      lines.push(`    输入: ${u.promptTokens.toLocaleString()} tokens (缓存 ${cacheRate}%)`);
      lines.push(`    输出: ${u.completionTokens.toLocaleString()} tokens`);
      lines.push(`    请求: ${u.requests} 次`);
      lines.push(`    费用: $${cost.toFixed(4)}`);
      lines.push('');
    }
    lines.push(`总计: ${this.totalTokens().toLocaleString()} tokens | ${this.formatCost()} | 缓存命中 ${this.cacheRate()}%`);
    return lines.join('\n');
  }

  /** 序列化为 JSON（用于持久化） */
  toJSON(): CostTrackerData {
    const models: Record<string, ModelUsage> = {};
    for (const [k, v] of this.models) models[k] = v;
    return {
      models,
      startedAt: this.startedAt.toISOString(),
      lastUpdatedAt: this.lastUpdatedAt.toISOString(),
    };
  }

  /** 从 JSON 恢复（用于会话恢复） */
  static fromJSON(data: CostTrackerData): CostTracker {
    const tracker = new CostTracker();
    tracker.startedAt = new Date(data.startedAt);
    tracker.lastUpdatedAt = new Date(data.lastUpdatedAt);
    for (const [k, v] of Object.entries(data.models)) {
      tracker.models.set(k, v);
    }
    return tracker;
  }
}
