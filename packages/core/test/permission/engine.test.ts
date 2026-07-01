import { describe, it, expect } from 'vitest';
import { PermissionEngine, isDangerous } from '../../src/permission/engine.js';

describe('isDangerous (blacklist)', () => {
  it('detects rm -rf /', () => {
    expect(isDangerous('rm -rf /')).toBe(true);
    expect(isDangerous('rm -rf /*')).toBe(true);
  });
  it('detects sudo', () => {
    expect(isDangerous('sudo apt install foo')).toBe(true);
  });
  it('detects fork bomb', () => {
    expect(isDangerous(':(){ :|:& };:')).toBe(true);
  });
  it('does not flag harmless rm', () => {
    expect(isDangerous('rm -f /tmp/x')).toBe(false);
    expect(isDangerous('ls -la')).toBe(false);
  });
});

describe('PermissionEngine', () => {
  it('asks by default when no rules', () => {
    const e = new PermissionEngine({});
    expect(e.check({ tool: 'Bash', matcher: 'git status', summary: 'git status' })).toBe('ask');
  });

  it('forbids blacklisted Bash regardless of rules', () => {
    const e = new PermissionEngine({
      projectRules: [{ tool: 'Bash', matcher: 'sudo apt', decision: 'allow' }],
    });
    expect(e.check({ tool: 'Bash', matcher: 'sudo apt', summary: 'sudo apt install foo' })).toBe('forbidden');
  });

  it('global rules apply', () => {
    const e = new PermissionEngine({
      globalRules: [{ tool: 'Bash', matcher: 'git status', decision: 'allow' }],
    });
    expect(e.check({ tool: 'Bash', matcher: 'git status', summary: 'git status -s' })).toBe('allow');
  });

  it('project rules override global', () => {
    const e = new PermissionEngine({
      globalRules: [{ tool: 'Bash', matcher: 'rm', decision: 'allow' }],
      projectRules: [{ tool: 'Bash', matcher: 'rm', decision: 'deny' }],
    });
    expect(e.check({ tool: 'Bash', matcher: 'rm', summary: 'rm a.txt' })).toBe('deny');
  });

  it('session-remembered rules win over all', () => {
    const e = new PermissionEngine({
      projectRules: [{ tool: 'Edit', matcher: '/x/y.ts', decision: 'deny' }],
    });
    e.remember({ tool: 'Edit', matcher: '/x/y.ts', summary: '/x/y.ts' }, 'allow', 'session');
    expect(e.check({ tool: 'Edit', matcher: '/x/y.ts', summary: '/x/y.ts' })).toBe('allow');
  });
});
