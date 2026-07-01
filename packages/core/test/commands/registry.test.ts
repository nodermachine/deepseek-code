import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { Command } from '../../src/commands/types.js';

const mk = (name: string, source: Command['source'], desc = ''): Command => ({
  name,
  description: desc,
  body: 'x',
  source,
});

describe('CommandRegistry', () => {
  it('registerBuiltin wins over ingestSkillCommands with same name', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('help', 'builtin', 'B'));
    r.ingestSkillCommands([
      { name: 'help', description: 'S', content: 'x', trigger: { type: 'command', name: 'help' } },
    ]);
    expect(r.resolve('help')!.source).toBe('builtin');
    expect(r.resolve('help')!.description).toBe('B');
  });

  it('empty query returns all sorted by priority then name', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('help', 'builtin'));
    r.registerBuiltin(mk('model', 'builtin'));
    const all = r.filter('');
    expect(all.map((x) => x.cmd.name)).toEqual(['help', 'model']);
  });

  it('filter ranks by fuzzy score', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('memory', 'builtin'));
    r.registerBuiltin(mk('model', 'builtin'));
    r.registerBuiltin(mk('mcp', 'builtin'));
    const filtered = r.filter('mo');
    expect(filtered[0].cmd.name).toBe('model');
    expect(filtered.map((x) => x.cmd.name)).toContain('memory');
    expect(filtered.map((x) => x.cmd.name)).not.toContain('mcp');
  });

  it('skill command does not override builtin', () => {
    const r = new CommandRegistry();
    r.registerBuiltin(mk('clear', 'builtin', 'BI'));
    r.ingestSkillCommands([
      { name: 'clear', description: 'S', content: 'x', trigger: { type: 'command', name: 'clear' } },
    ]);
    expect(r.resolve('clear')!.description).toBe('BI');
  });
});
