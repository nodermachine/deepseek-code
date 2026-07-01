import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlLogger, NullLogger } from '../src/logger.js';

describe('Logger', () => {
  it('NullLogger is no-op', () => {
    const l = new NullLogger();
    expect(() => l.info('x', { a: 1 })).not.toThrow();
    expect(() => l.event('done', {})).not.toThrow();
  });

  it('JsonlLogger writes one JSON object per line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsclog-'));
    const file = join(dir, 'log.jsonl');
    const l = new JsonlLogger(file);
    l.info('hello', { x: 1 });
    l.event('tool_call', { name: 'Read' });
    await l.flush();
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.level).toBe('info');
    expect(first.msg).toBe('hello');
    expect(first.x).toBe(1);
    expect(typeof first.ts).toBe('string');
    const second = JSON.parse(lines[1]);
    expect(second.type).toBe('tool_call');
    expect(second.name).toBe('Read');
    rmSync(dir, { recursive: true, force: true });
  });
});
