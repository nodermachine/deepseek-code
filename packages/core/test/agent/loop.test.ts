import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runAgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { PermissionEngine } from '../../src/permission/engine.js';
import { MemorySessionStore } from '../../src/session/memory.js';
import { NullLogger } from '../../src/logger.js';
import type { Provider, ChatRequest } from '../../src/provider/types.js';
import type { ProviderEvent, AgentEvent } from '../../src/types.js';

class FakeProvider implements Provider {
  constructor(private scripts: ProviderEvent[][]) {}
  async *stream(_req: ChatRequest): AsyncIterable<ProviderEvent> {
    const next = this.scripts.shift();
    if (!next) throw new Error('no more scripted responses');
    for (const ev of next) yield ev;
  }
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const echoTool = {
  name: 'Echo',
  description: 'echoes',
  inputSchema: z.object({ msg: z.string() }),
  needsPermission: () => null,
  async execute(input: { msg: string }) {
    return { ok: true as const, output: { echoed: input.msg } };
  },
};

describe('runAgentLoop', () => {
  it('returns natural done when model emits only text', async () => {
    const provider = new FakeProvider([[
      { type: 'text_delta', text: 'hi' },
      { type: 'finish', reason: 'stop' },
    ]]);
    const events = await collect(runAgentLoop({
      provider,
      registry: new ToolRegistry(),
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'hello',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.find(e => e.type === 'text_delta')).toBeDefined();
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });

  it('executes a tool then continues to natural done', async () => {
    const provider = new FakeProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Echo', args: { msg: 'hi' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const events = await collect(runAgentLoop({
      provider,
      registry,
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'use Echo',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.find(e => e.type === 'tool_call_start')).toBeDefined();
    expect(events.find(e => e.type === 'tool_call_result' && (e as any).result.ok)).toBeDefined();
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });

  it('stops at max_steps', async () => {
    const scripts: ProviderEvent[][] = Array.from({ length: 10 }, () => [
      { type: 'tool_call_done' as const, id: 'c1', name: 'Echo', args: { msg: 'x' } },
      { type: 'finish' as const, reason: 'tool_calls' as const },
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const events = await collect(runAgentLoop({
      provider: new FakeProvider(scripts),
      registry,
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'spam',
      model: 'deepseek-chat',
      maxSteps: 3,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'max_steps' });
  });

  it('R1 model omits tools', async () => {
    let capturedRequest: ChatRequest | null = null;
    const provider: Provider = {
      async *stream(req) { capturedRequest = req; yield { type: 'text_delta', text: 'hi' }; yield { type: 'finish', reason: 'stop' }; },
    };
    const registry = new ToolRegistry();
    registry.register(echoTool);
    await collect(runAgentLoop({
      provider,
      registry,
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'hi',
      model: 'deepseek-reasoner',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(capturedRequest!.tools).toBeUndefined();
  });
});
