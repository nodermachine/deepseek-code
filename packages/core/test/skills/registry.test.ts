/**
 * @file SkillRegistry 单元测试
 * 测试注册表的查询能力：always-on、command、keyword 匹配
 */
import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { Skill } from '../../src/skills/types.js';

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

describe('SkillRegistry', () => {
  it('getAlwaysOn returns only always-trigger skills', () => {
    const reg = new SkillRegistry({ builtins: false });
    reg.register(makeSkill({ name: 'a', trigger: { type: 'always' } }));
    reg.register(makeSkill({ name: 'b', trigger: { type: 'command', name: 'b' } }));
    reg.register(makeSkill({ name: 'c', trigger: { type: 'auto', keywords: ['x'] } }));

    const always = reg.getAlwaysOn();
    expect(always).toHaveLength(1);
    expect(always[0].name).toBe('a');
  });

  it('getByCommand finds correct skill', () => {
    const reg = new SkillRegistry({ builtins: false });
    reg.register(makeSkill({ name: 'review', trigger: { type: 'command', name: 'review' } }));
    reg.register(makeSkill({ name: 'deploy', trigger: { type: 'command', name: 'deploy' } }));

    expect(reg.getByCommand('review')?.name).toBe('review');
    expect(reg.getByCommand('deploy')?.name).toBe('deploy');
    expect(reg.getByCommand('unknown')).toBeUndefined();
  });

  it('matchByKeywords matches case-insensitively', () => {
    const reg = new SkillRegistry({ builtins: false });
    reg.register(makeSkill({
      name: 'react',
      trigger: { type: 'auto', keywords: ['react', 'component'] },
    }));
    reg.register(makeSkill({
      name: 'vue',
      trigger: { type: 'auto', keywords: ['vue', 'template'] },
    }));

    const matched = reg.matchByKeywords('帮我创建一个 React 组件');
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('react');
  });

  it('matchByKeywords returns empty for no match', () => {
    const reg = new SkillRegistry({ builtins: false });
    reg.register(makeSkill({
      name: 'react',
      trigger: { type: 'auto', keywords: ['react'] },
    }));

    expect(reg.matchByKeywords('写一个 Python 脚本')).toHaveLength(0);
  });

  it('matchByKeywords ignores non-auto skills', () => {
    const reg = new SkillRegistry({ builtins: false });
    reg.register(makeSkill({ name: 'a', trigger: { type: 'always' } }));
    reg.register(makeSkill({ name: 'b', trigger: { type: 'command', name: 'b' } }));

    expect(reg.matchByKeywords('anything')).toHaveLength(0);
  });

  it('register overrides same-name skill', () => {
    const reg = new SkillRegistry({ builtins: false });
    reg.register(makeSkill({ name: 'x', description: 'v1' }));
    reg.register(makeSkill({ name: 'x', description: 'v2' }));

    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].description).toBe('v2');
  });

  it('list returns all skills', () => {
    const reg = new SkillRegistry({ builtins: false });
    reg.register(makeSkill({ name: 'a' }));
    reg.register(makeSkill({ name: 'b' }));
    reg.register(makeSkill({ name: 'c' }));

    expect(reg.list()).toHaveLength(3);
  });
});
