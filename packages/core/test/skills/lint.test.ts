import { describe, it, expect } from 'vitest';
import { lintSkills } from '../../src/skills/lint.js';
import type { Skill } from '../../src/skills/types.js';

const mk = (o: Partial<Skill>): Skill => ({
  name: 'x',
  description: 'x desc',
  trigger: { type: 'command', name: 'x' },
  content: 'body',
  filePath: '/x.md',
  ...o,
});

describe('lintSkills', () => {
  it('warns when description missing', () => {
    const w = lintSkills([mk({ name: 'foo', description: 'foo' })]);
    expect(w.find(x => x.code === 'missing-description')).toBeDefined();
  });

  it('warns auto trigger without keywords', () => {
    const w = lintSkills([mk({ trigger: { type: 'auto', keywords: [] } })]);
    expect(w.find(x => x.code === 'auto-without-keywords')).toBeDefined();
  });

  it('warns always-on with huge body', () => {
    const w = lintSkills([mk({ trigger: { type: 'always' }, content: 'x'.repeat(5000) })]);
    expect(w.find(x => x.code === 'always-too-large')).toBeDefined();
  });

  it('warns command name colliding with builtin', () => {
    const w = lintSkills([mk({ name: 'my-help', trigger: { type: 'command', name: 'help' } })]);
    expect(w.find(x => x.code === 'command-collides-with-builtin')).toBeDefined();
  });

  it('warns HTML-comment-only metadata', () => {
    const w = lintSkills([mk({ content: '<!-- trigger: auto -->\n\nbody' })]);
    expect(w.find(x => x.code === 'html-comment-metadata-only')).toBeDefined();
  });

  it('no warnings on a well-formed skill', () => {
    const w = lintSkills([mk({
      name: 'good',
      description: 'a good skill',
      trigger: { type: 'auto', keywords: ['alpha', 'beta'] },
      content: 'ok',
    })]);
    expect(w).toHaveLength(0);
  });
});
