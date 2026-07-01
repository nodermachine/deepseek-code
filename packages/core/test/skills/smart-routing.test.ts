/**
 * @file Skills 智能路由测试
 * 覆盖：扩充关键词匹配、skill catalog 生成、模型驱动 [activate-skill] 注入
 */
import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '../../src/skills/registry.js';
import { buildSkillCatalog } from '../../src/prompts.js';
import { runAgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { PermissionEngine } from '../../src/permission/engine.js';
import { MemorySessionStore } from '../../src/session/memory.js';
import { NullLogger } from '../../src/logger.js';
import type { Provider, ChatRequest } from '../../src/provider/types.js';
import type { ProviderEvent, AgentEvent } from '../../src/types.js';
import type { Skill } from '../../src/skills/types.js';

// === 辅助 ===

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    name: 'test',
    description: 'test skill',
    trigger: { type: 'command', name: 'test' },
    content: 'test content',
    filePath: '/fake/test.md',
    ...overrides,
  };
}

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

// === 测试 ===

describe('Skills 智能路由 - 扩充关键词匹配', () => {
  it('中文"设计"触发 brainstorming skill', () => {
    const reg = new SkillRegistry(); // 含内置 skills
    const matched = reg.matchByKeywords('帮我设计一下这个模块的架构');
    const names = matched.map(s => s.name);
    expect(names).toContain('brainstorming');
  });

  it('中文"架构"触发 brainstorming skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('我有一个架构问题想讨论');
    const names = matched.map(s => s.name);
    expect(names).toContain('brainstorming');
  });

  it('中文"复杂"触发 brainstorming skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('这个任务比较复杂');
    const names = matched.map(s => s.name);
    expect(names).toContain('brainstorming');
  });

  it('中文"方案"触发 brainstorming skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('先出个方案再动手');
    const names = matched.map(s => s.name);
    expect(names).toContain('brainstorming');
  });

  it('"design" 触发 brainstorming skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('I need to design a new API');
    expect(matched.map(s => s.name)).toContain('brainstorming');
  });

  it('中文"调试"触发 systematic-debugging skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('帮我调试一下这个问题');
    expect(matched.map(s => s.name)).toContain('systematic-debugging');
  });

  it('中文"崩了"触发 systematic-debugging skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('程序崩了');
    expect(matched.map(s => s.name)).toContain('systematic-debugging');
  });

  it('"unexpected" 触发 systematic-debugging skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('getting unexpected results');
    expect(matched.map(s => s.name)).toContain('systematic-debugging');
  });

  it('无关输入不触发任何 auto skill', () => {
    const reg = new SkillRegistry();
    const matched = reg.matchByKeywords('今天天气怎么样');
    // 不应该匹配 brainstorming 或 debugging（"怎么"不等于"怎么做"）
    const names = matched.map(s => s.name);
    expect(names).not.toContain('brainstorming');
    expect(names).not.toContain('systematic-debugging');
  });
});

describe('Skills 智能路由 - Skill Catalog 生成', () => {
  it('生成非 always-on skills 的目录', () => {
    const skills = [
      makeSkill({ name: 'web-fetch', description: '抓取网页', trigger: { type: 'command', name: 'web-fetch' } }),
      makeSkill({ name: 'brainstorming', description: '设计流程', trigger: { type: 'auto', keywords: ['设计'] } }),
      makeSkill({ name: 'verify', description: '验证协议', trigger: { type: 'always' } }),
    ];
    const catalog = buildSkillCatalog(skills);
    // always-on 的 verify 不应出现
    expect(catalog).not.toContain('verify');
    // command 和 auto 应出现
    expect(catalog).toContain('web-fetch: 抓取网页');
    expect(catalog).toContain('brainstorming: 设计流程');
    // 包含激活指令
    expect(catalog).toContain('[activate-skill:');
  });

  it('全是 always-on 时返回空字符串', () => {
    const skills = [
      makeSkill({ name: 'a', trigger: { type: 'always' } }),
    ];
    expect(buildSkillCatalog(skills)).toBe('');
  });

  it('空列表返回空字符串', () => {
    expect(buildSkillCatalog([])).toBe('');
  });
});

describe('Skills 智能路由 - 模型驱动 [activate-skill] 注入', () => {
  it('模型输出 [activate-skill: xxx] 时注入 skill 内容并继续循环', async () => {
    // 第一轮：模型输出 activate 标记
    // 第二轮：模型读取 skill 后正常回复
    const provider = new FakeProvider([
      [
        { type: 'text_delta', text: '让我激活设计技能 [activate-skill: brainstorming]' },
        { type: 'finish', reason: 'stop' },
      ],
      [
        { type: 'text_delta', text: '好的，我按照设计流程来处理。' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const skillRegistry = new SkillRegistry({ builtins: false });
    skillRegistry.register(makeSkill({
      name: 'brainstorming',
      description: '设计流程',
      trigger: { type: 'auto', keywords: ['设计'] },
      content: '先确认范围，再给出方案。',
    }));

    const session = new MemorySessionStore().create();
    const events = await collect(runAgentLoop({
      provider,
      registry: new ToolRegistry(),
      permission: new PermissionEngine(),
      session,
      userInput: '帮我规划一下',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
      skillRegistry,
    }));

    // 应该循环了 2 轮（activate → 注入 → 再次回复）
    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas.length).toBeGreaterThanOrEqual(2);
    // 最终应该 natural done
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
    // session 中应有注入的 skill 内容
    const skillMsg = session.messages.find(m => m.role === 'user' && m.content?.includes('[Skill: brainstorming]'));
    expect(skillMsg).toBeDefined();
    expect(skillMsg!.content).toContain('先确认范围，再给出方案。');
  });

  it('模型输出 [activate-skill: unknown] 时正常结束（未找到 skill）', async () => {
    const provider = new FakeProvider([
      [
        { type: 'text_delta', text: '试试 [activate-skill: nonexistent]' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const skillRegistry = new SkillRegistry({ builtins: false });
    const events = await collect(runAgentLoop({
      provider,
      registry: new ToolRegistry(),
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'hi',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
      skillRegistry,
    }));

    // skill 不存在时应正常结束，不触发额外循环
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });

  it('无 skillRegistry 时 [activate-skill] 标记被忽略', async () => {
    const provider = new FakeProvider([
      [
        { type: 'text_delta', text: '[activate-skill: brainstorming]' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const events = await collect(runAgentLoop({
      provider,
      registry: new ToolRegistry(),
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'hi',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
      // 不传 skillRegistry
    }));

    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });
});
