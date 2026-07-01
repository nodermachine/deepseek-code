/**
 * @file 工具级并行执行测试
 * 验证 Agent Loop 中工具调用从串行改为并行后的正确性
 */
import { describe, it, expect } from 'vitest';
import { runAgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { PermissionEngine } from '../../src/permission/engine.js';
import { MemorySessionStore } from '../../src/session/memory.js';
import { NullLogger } from '../../src/logger.js';
import type { Provider, ChatRequest } from '../../src/provider/types.js';
import type { ProviderEvent, AgentEvent } from '../../src/types.js';
import type { Tool, ToolContext, ToolResult } from '../../src/tools/types.js';
import { z } from 'zod';

/** 脚本化 Provider：依次返回预设的事件序列 */
class ScriptedProvider implements Provider {
  constructor(private scripts: ProviderEvent[][]) {}
  async *stream(_req: ChatRequest): AsyncIterable<ProviderEvent> {
    const next = this.scripts.shift();
    if (!next) throw new Error('exhausted scripts');
    for (const e of next) yield e;
  }
}

/** 创建一个简单的延迟工具用于验证并行性 */
function makeDelayTool(name: string, delayMs: number): Tool<{ value: string }, string> {
  return {
    name,
    description: `delay ${delayMs}ms`,
    inputSchema: z.object({ value: z.string() }),
    needsPermission: () => null,
    async execute(input: { value: string }, ctx: ToolContext): Promise<ToolResult<string>> {
      await new Promise(r => setTimeout(r, delayMs));
      return { ok: true, output: `${name}:${input.value}` };
    },
  };
}

/** 创建需要权限的工具 */
function makePermTool(name: string): Tool<{ cmd: string }, string> {
  return {
    name,
    description: `perm tool`,
    inputSchema: z.object({ cmd: z.string() }),
    needsPermission: (input) => ({ tool: name, matcher: input.cmd, summary: input.cmd }),
    async execute(input: { cmd: string }): Promise<ToolResult<string>> {
      return { ok: true, output: `executed:${input.cmd}` };
    },
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('parallel tool execution', () => {
  it('executes multiple tools in parallel (faster than serial)', async () => {
    // 3 个各 50ms 的工具，并行应该 ≈50ms，串行 ≈150ms
    const registry = new ToolRegistry();
    registry.register(makeDelayTool('A', 50));
    registry.register(makeDelayTool('B', 50));
    registry.register(makeDelayTool('C', 50));

    const provider = new ScriptedProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'A', args: { value: 'a' } },
        { type: 'tool_call_done', id: 'c2', name: 'B', args: { value: 'b' } },
        { type: 'tool_call_done', id: 'c3', name: 'C', args: { value: 'c' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'done' }, { type: 'finish', reason: 'stop' }],
    ]);

    const session = new MemorySessionStore().create();
    const start = Date.now();
    const events = await collect(runAgentLoop({
      provider, registry, permission: new PermissionEngine(),
      session, userInput: 'test', model: 'deepseek-chat', maxSteps: 5,
      signal: new AbortController().signal, logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    const elapsed = Date.now() - start;

    // 并行执行 ≈50-100ms，串行至少 150ms
    expect(elapsed).toBeLessThan(140);

    // 验证所有结果都正确返回
    const results = events.filter(e => e.type === 'tool_call_result') as any[];
    expect(results).toHaveLength(3);
    expect(results[0].result.output).toBe('A:a');
    expect(results[1].result.output).toBe('B:b');
    expect(results[2].result.output).toBe('C:c');
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });

  it('denied tool does not block others from executing', async () => {
    const registry = new ToolRegistry();
    registry.register(makePermTool('Danger'));
    registry.register(makeDelayTool('Safe', 10));

    const provider = new ScriptedProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Danger', args: { cmd: 'bad' } },
        { type: 'tool_call_done', id: 'c2', name: 'Safe', args: { value: 'ok' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'ok' }, { type: 'finish', reason: 'stop' }],
    ]);

    const session = new MemorySessionStore().create();
    const events = await collect(runAgentLoop({
      provider, registry, permission: new PermissionEngine(),
      session, userInput: 'test', model: 'deepseek-chat', maxSteps: 5,
      signal: new AbortController().signal, logger: new NullLogger(),
      // Danger 被 deny，Safe 被 allow
      askPermission: async (req) => ({
        decision: req.matcher === 'bad' ? 'deny' : 'allow',
        remember: false,
      }),
    }));

    const results = events.filter(e => e.type === 'tool_call_result') as any[];
    expect(results).toHaveLength(2);
    // Danger 被拒绝
    expect(results[0].result.ok).toBe(false);
    expect(results[0].result.error).toBe('permission_denied');
    // Safe 正常执行
    expect(results[1].result.ok).toBe(true);
    expect(results[1].result.output).toBe('Safe:ok');
  });

  it('abort cancels parallel execution', async () => {
    // 创建一个支持 abort 的工具
    const abortableTool: Tool<{ value: string }, string> = {
      name: 'Slow',
      description: 'abortable delay',
      inputSchema: z.object({ value: z.string() }),
      needsPermission: () => null,
      async execute(input, ctx): Promise<ToolResult<string>> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ok: true, output: 'done' }), 5000);
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve({ ok: false, error: 'aborted', recoverable: false });
          });
        });
      },
    };

    const registry = new ToolRegistry();
    registry.register(abortableTool);

    const provider = new ScriptedProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Slow', args: { value: 'x' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
    ]);

    const session = new MemorySessionStore().create();
    const ctl = new AbortController();

    // 50ms 后中止
    setTimeout(() => ctl.abort(), 50);

    const events = await collect(runAgentLoop({
      provider, registry, permission: new PermissionEngine(),
      session, userInput: 'test', model: 'deepseek-chat', maxSteps: 5,
      signal: ctl.signal, logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));

    // 工具应该返回 error 结果，然后下一轮 loop 检测到 abort
    const doneEvent = events.find(e => e.type === 'done') as any;
    expect(doneEvent).toBeDefined();
    expect(doneEvent.reason).toBe('abort');
  }, 3000);
});
