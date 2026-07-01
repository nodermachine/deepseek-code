import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRegistry } from '../../src/skills/registry.js';
import { getBuiltinSkills } from '../../src/skills/builtin.js';

describe('builtin process skills', () => {
  it('exposes systematic-debugging / brainstorming / verification-before-completion', () => {
    const names = getBuiltinSkills().map((s) => s.name).sort();
    expect(names).toEqual(['brainstorming', 'systematic-debugging', 'verification-before-completion']);
  });

  it('verification-before-completion is always-on', () => {
    const v = getBuiltinSkills().find((s) => s.name === 'verification-before-completion')!;
    expect(v.trigger.type).toBe('always');
  });

  it('systematic-debugging auto-triggers on debug keywords (cn + en)', () => {
    const r = new SkillRegistry();
    expect(r.matchByKeywords('this test fails').map((s) => s.name)).toContain('systematic-debugging');
    expect(r.matchByKeywords('这里报错了').map((s) => s.name)).toContain('systematic-debugging');
    expect(r.matchByKeywords('why doesn\'t it work').map((s) => s.name)).toContain('systematic-debugging');
  });

  it('brainstorming auto-triggers on build/implement keywords', () => {
    const r = new SkillRegistry();
    expect(r.matchByKeywords('implement a login flow').map((s) => s.name)).toContain('brainstorming');
    expect(r.matchByKeywords('帮我加一个 X 功能').map((s) => s.name)).toContain('brainstorming');
    expect(r.matchByKeywords('重构一下这块').map((s) => s.name)).toContain('brainstorming');
  });

  it('always-on skills include verification-before-completion by default', () => {
    const r = new SkillRegistry();
    const always = r.getAlwaysOn().map((s) => s.name);
    expect(always).toContain('verification-before-completion');
  });

  it('disk-loaded skill with same name overrides builtin (escape hatch)', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
    const projSkillsDir = join(cwd, '.deepseek-code', 'skills');
    mkdirSync(projSkillsDir, { recursive: true });
    writeFileSync(
      join(projSkillsDir, 'verification-before-completion.md'),
      '---\ndescription: MY OVERRIDE\ntrigger: always\n---\n\n# override\n\nnew body',
    );

    const r = new SkillRegistry();
    r.loadFromDisk({ cwd, homeDir: home });

    const v = r.list().find((s) => s.name === 'verification-before-completion')!;
    expect(v.description).toBe('MY OVERRIDE');
    expect(v.content).toContain('new body');

    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('SkillRegistry starts with builtins injected (no loadFromDisk needed)', () => {
    const r = new SkillRegistry();
    expect(r.list().length).toBeGreaterThanOrEqual(3);
    expect(r.list().find((s) => s.name === 'brainstorming')).toBeDefined();
  });
});
