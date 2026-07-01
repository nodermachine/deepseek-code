import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '@deepseek-code/core';
import { routeInput } from '../../src/router/index.js';

function mkReg() {
  const r = new CommandRegistry();
  r.registerBuiltin({ name: 'help', description: 'H', body: '', source: 'builtin' });
  r.registerBuiltin({ name: 'plan', description: 'P', body: '', source: 'builtin' });
  (r as any).byName.set('pr', {
    name: 'pr',
    description: 'PR',
    body: 'do PR $1 $ARGUMENTS',
    source: 'project',
    allowedTools: ['Bash'],
    model: 'deepseek-chat',
  });
  return r;
}

describe('routeInput', () => {
  it('routes plain text to passthrough', () => {
    const r = routeInput('hello world', mkReg());
    expect(r).toEqual({ kind: 'passthrough', text: 'hello world' });
  });

  it('routes /help to builtin', () => {
    const r = routeInput('/help', mkReg());
    expect(r).toEqual({ kind: 'builtin', name: 'help', args: '' });
  });

  it('routes /plan with args to builtin', () => {
    const r = routeInput('/plan refactor auth', mkReg());
    expect(r).toEqual({ kind: 'builtin', name: 'plan', args: 'refactor auth' });
  });

  it('routes user command to agent with expanded body + overrides', () => {
    const r = routeInput('/pr main extra info', mkReg());
    expect(r.kind).toBe('agent');
    if (r.kind === 'agent') {
      expect(r.prompt).toBe('do PR main main extra info');
      expect(r.allowedTools).toEqual(['Bash']);
      expect(r.modelOverride).toBe('deepseek-chat');
    }
  });

  it('unknown slash returns unknown', () => {
    const r = routeInput('/nope', mkReg());
    expect(r).toEqual({ kind: 'unknown', name: 'nope' });
  });

  it('/skills/<name> is treated as unknown so REPL handles legacy path', () => {
    const r = routeInput('/skills/foo bar', mkReg());
    expect(r.kind).toBe('unknown');
  });
});
