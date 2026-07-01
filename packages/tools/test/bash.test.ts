import { describe, it, expect } from 'vitest';
import { bashTool } from '../src/bash.js';
import { NullLogger } from '@deepseek-code/core';

function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger(), session: { readFiles: new Set<string>() } };
}

describe('Bash tool', () => {
  it('runs a simple command', async () => {
    const r = await bashTool.execute({ command: 'echo hello' }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.stdout.trim()).toBe('hello');
      expect(r.output.exit_code).toBe(0);
      expect(r.output.timed_out).toBe(false);
    }
  });

  it('captures stderr and non-zero exit', async () => {
    const r = await bashTool.execute({ command: 'echo oops >&2; exit 3' }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.stderr.trim()).toBe('oops');
      expect(r.output.exit_code).toBe(3);
    }
  });

  it('times out long commands', async () => {
    const r = await bashTool.execute({ command: 'sleep 5', timeout_ms: 100 }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.timed_out).toBe(true);
  });

  it('emits PermissionRequest with prefix matcher', () => {
    const pr = bashTool.needsPermission({ command: 'git status -s' });
    expect(pr).not.toBeNull();
    expect(pr!.tool).toBe('Bash');
    expect(pr!.matcher).toBe('git status');
  });

  it('single-token command yields single-token matcher', () => {
    const pr = bashTool.needsPermission({ command: 'ls -la /tmp' });
    expect(pr!.matcher).toBe('ls');
  });
});
