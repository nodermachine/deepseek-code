/**
 * @file DeepSeek Provider 实现
 * 封装对 DeepSeek API 的 SSE 流式调用，支持重试、R1 推理分离、abort 取消
 */
import type { Provider, ChatRequest } from './types.js';
import type { ProviderEvent } from '../types.js';
import { parseSSEStream } from './sse.js';
import { DeepseekCodeError } from '../errors.js';

export interface RetryOpts {
  initialMs?: number;
  maxAttempts?: number;
  maxMs?: number;
}

export interface DeepseekProviderOpts {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  retry?: RetryOpts;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

/**
 * DeepSeek 模型 Provider
 * - 支持 SSE 流式输出
 * - 429/5xx 指数退避重试
 * - R1 reasoning_content 分离为 thinking_delta
 * - 工具调用参数增量拼接 + JSON 解析
 */
export class DeepseekProvider implements Provider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly initialMs: number;
  private readonly maxAttempts: number;
  private readonly maxMs: number;

  constructor(opts: DeepseekProviderOpts) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
    this.initialMs = opts.retry?.initialMs ?? 1000;
    this.maxAttempts = opts.retry?.maxAttempts ?? 3;
    this.maxMs = opts.retry?.maxMs ?? 8000;
  }

  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    // 构造请求体，排除 undefined 字段（DeepSeek API 对多余字段敏感）
    const payload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
    };
    // 只有有工具时才传 tools 字段，否则 API 可能报 400
    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools;
      payload.tool_choice = 'auto';
      if (req.parallelToolCalls !== undefined) payload.parallel_tool_calls = req.parallelToolCalls;
    }
    if (req.temperature !== undefined) {
      payload.temperature = req.temperature;
    }
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    if (req.stop !== undefined) payload.stop = req.stop;
    // V4 thinking 模式控制：thinking + tool_calls 可并行
    if (req.thinking) {
      payload.thinking = req.thinking;
      // thinking 启用时不能设置 temperature（API 限制）
      if (req.thinking.type === 'enabled') delete payload.temperature;
    }
    if (req.reasoning_effort !== undefined) payload.reasoning_effort = req.reasoning_effort;
    const body = JSON.stringify(payload);
    let resp: Response | null = null;
    let attempt = 0;
    let delay = this.initialMs;
    while (true) {
      attempt++;
      try {
        resp = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${this.apiKey}`,
          },
          body,
          signal,
        });
      } catch (cause) {
        if (signal.aborted) throw new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消', cause });
        if (attempt >= this.maxAttempts) throw new DeepseekCodeError({ code: 'PROVIDER_NETWORK', message: 'network error', userMessage: '网络错误，请检查连接', cause });
        await sleep(Math.min(delay, this.maxMs), signal);
        delay *= 2;
        continue;
      }
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt >= this.maxAttempts) {
          throw new DeepseekCodeError({
            code: `PROVIDER_HTTP_${resp.status}`,
            message: `http ${resp.status}`,
            userMessage: resp.status === 429 ? '请求过于频繁，请稍后再试' : `DeepSeek 服务异常 (HTTP ${resp.status})`,
            recoverable: true,
          });
        }
        await sleep(Math.min(delay, this.maxMs), signal);
        delay *= 2;
        continue;
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new DeepseekCodeError({ code: 'PROVIDER_AUTH', message: `http ${resp.status}`, userMessage: 'API key 无效或权限不足' });
      }
      if (!resp.ok) {
        const text = await safeText(resp);
        throw new DeepseekCodeError({ code: `PROVIDER_HTTP_${resp.status}`, message: `http ${resp.status}: ${text}`, userMessage: `DeepSeek 调用失败：HTTP ${resp.status}` });
      }
      break;
    }
    if (!resp.body) throw new DeepseekCodeError({ code: 'PROVIDER_STREAM_BROKEN', message: 'no body', userMessage: '响应流为空' });

    const accumulators = new Map<number, ToolCallAccumulator>();

    try {
      for await (const data of parseSSEStream(resp.body, signal)) {
        if (data === '[DONE]') continue;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        const choice = chunk.choices?.[0];
        if (!choice) {
          if (chunk.usage) yield { type: 'usage', usage: chunk.usage };
          continue;
        }
        const delta = choice.delta ?? {};
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length) {
          yield { type: 'thinking_delta', text: delta.reasoning_content };
        }
        if (typeof delta.content === 'string' && delta.content.length) {
          yield { type: 'text_delta', text: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const acc = accumulators.get(idx) ?? { id: '', name: '', args: '' };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
            accumulators.set(idx, acc);
            yield { type: 'tool_call_delta', id: acc.id, name: tc.function?.name, argsDelta: tc.function?.arguments ?? '' };
          }
        }
        if (choice.finish_reason) {
          for (const acc of accumulators.values()) {
            let args: unknown;
            try { args = acc.args ? JSON.parse(acc.args) : {}; } catch {
              // JSON 解析失败时不抛错，回喂原始字符串让模型自修复
              args = { __raw_invalid_json: acc.args };
            }
            yield { type: 'tool_call_done', id: acc.id, name: acc.name, args };
          }
          if (chunk.usage) yield { type: 'usage', usage: chunk.usage };
          yield { type: 'finish', reason: choice.finish_reason };
        }
      }
    } catch (e) {
      if ((e as any)?.code === 'ABORT_ERR' || signal.aborted) {
        throw new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消', cause: e });
      }
      throw e;
    }
  }
}

async function safeText(r: Response): Promise<string> {
  try { return await r.text(); } catch { return ''; }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消' }));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消' })); }, { once: true });
  });
}
