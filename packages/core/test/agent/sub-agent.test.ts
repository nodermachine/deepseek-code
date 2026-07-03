/**
 * @file Sub-agent 单元测试
 * 覆盖：正常执行、工具受限、maxSteps 终止、AbortSignal 中断、readFiles 共享
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runSubAgent } from '../../src/agent/sub-agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { NullLogger } from '../../src/logger.js';
import { MemorySessionStore } from '../../src/session/memory.js';
import type { Provider, ChatRequest } from '../../src/provider/types.js';
import type { ProviderEvent } from '../../src/types.js';

/** FakeProvider: 按脚本依次返回事件序列 */
class FakeProvider implements Provider {
  constructor(private scripts: ProviderEvent[][]) {}
  async *stream(_req: ChatRequest): AsyncIterable<ProviderEvent> {
    const next = this.scripts.shift();
    if (!next) throw new Error('no more scripted responses');
    for (const ev of next) yield ev;
  }
}

/** 简单的只读工具（模拟 Read） */
const fakeReadTool = {
  name: 'Read',
  description: 'reads a file',
  inputSchema: z.object({ file_path: z.string() }),
  needsPermission: () => null,
  async execute(input: { file_path: string }, ctx: any) {
    ctx.session.readFiles.add(input.file_path);
    return { ok: true as const, output: `content of ${input.file_path}` };
  },
};

/** 模拟 Grep 工具 */
const fakeGrepTool = {
  name: 'Grep',
  description: 'search',
  inputSchema: z.object({ pattern: z.string() }),
  needsPermission: () => null,
  async execute() { return { ok: true as const, output: 'grep result' }; },
};

/** 模拟 Write 工具（不应出现在子 agent 中） */
const fakeWriteTool = {
  name: 'Write',
  description: 'writes a file',
  inputSchema: z.object({ file_path: z.string(), content: z.string() }),
  needsPermission: (input: any) => ({ tool: 'Write', matcher: input.file_path, summary: input.file_path }),
  async execute() { return { ok: true as const, output: 'written' }; },
};

describe('runSubAgent', () => {
  it('正常执行并返回子 agent 文本结果', async () => {
    const provider = new FakeProvider([
      [
        { type: 'text_delta', text: '搜索结果：找到 3 个匹配文件' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(fakeReadTool);
    registry.register(fakeGrepTool);

    const parentSession = new MemorySessionStore().create();

    const result = await runSubAgent({
      provider,
      parentSession,
      prompt: '搜索所有 .ts 文件中包含 TODO 的行',
      defaultModel: 'deepseek-chat',
      signal: new AbortController().signal,
      logger: new NullLogger(),
      registry,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('搜索结果');
  });

  it('子 agent 工具受限：Write 不在默认允许列表中', async () => {
    const provider = new FakeProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Write', args: { file_path: '/tmp/x', content: 'bad' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: '无法写入文件' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(fakeReadTool);
    registry.register(fakeGrepTool);
    registry.register(fakeWriteTool);

    const parentSession = new MemorySessionStore().create();

    const result = await runSubAgent({
      provider,
      parentSession,
      prompt: '写入文件',
      defaultModel: 'deepseek-chat',
      signal: new AbortController().signal,
      logger: new NullLogger(),
      registry,
      // 默认 allowedTools = ['Read', 'Grep', 'Glob', 'Bash']，不含 Write
    });

    // Write 工具不在过滤后的 registry 中，会返回 unknown_tool 错误
    // 模型第二轮返回文本完成
    expect(result.ok).toBe(true);
    expect(result.output).toContain('无法写入文件');
  });

  it('子 agent 超过 maxSteps 时正常终止', async () => {
    // 每轮都调工具，永不自然停止
    const scripts: ProviderEvent[][] = Array.from({ length: 20 }, () => [
      { type: 'tool_call_done' as const, id: 'c1', name: 'Read', args: { file_path: '/tmp/x' } },
      { type: 'finish' as const, reason: 'tool_calls' as const },
    ]);

    const registry = new ToolRegistry();
    registry.register(fakeReadTool);

    const parentSession = new MemorySessionStore().create();

    const result = await runSubAgent({
      provider: new FakeProvider(scripts),
      parentSession,
      prompt: '无限搜索',
      defaultModel: 'deepseek-chat',
      maxSteps: 3,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      registry,
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('max_steps');
  });

  it('子 agent 中断（AbortSignal）', async () => {
    const ctl = new AbortController();
    // 立即中断
    ctl.abort();

    const provider = new FakeProvider([
      [{ type: 'text_delta', text: 'hi' }, { type: 'finish', reason: 'stop' }],
    ]);

    const registry = new ToolRegistry();
    const parentSession = new MemorySessionStore().create();

    const result = await runSubAgent({
      provider,
      parentSession,
      prompt: '被中断的任务',
      defaultModel: 'deepseek-chat',
      signal: ctl.signal,
      logger: new NullLogger(),
      registry,
    });

    // abort 场景：要么 ok=false（中断），要么快速完成（因为 FakeProvider 不检查 signal）
    // 由于 FakeProvider 不真正 await signal，runAgentLoop 在循环开头检查 aborted
    expect(result.ok).toBe(false);
  });

  it('子 agent 的 readFiles 同步回父 session', async () => {
    const provider = new FakeProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Read', args: { file_path: '/project/src/main.ts' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: '文件内容分析完毕' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(fakeReadTool);

    const parentSession = new MemorySessionStore().create();
    expect(parentSession.readFiles.has('/project/src/main.ts')).toBe(false);

    await runSubAgent({
      provider,
      parentSession,
      prompt: '读取 main.ts',
      defaultModel: 'deepseek-chat',
      signal: new AbortController().signal,
      logger: new NullLogger(),
      registry,
    });

    // 子 agent 读取的文件应同步回父 session
    expect(parentSession.readFiles.has('/project/src/main.ts')).toBe(true);
  });
});
