import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskSessionStore } from '../../src/session/disk.js';

function mkDir(): string {
  return mkdtempSync(join(tmpdir(), 'disk-sess-'));
}

describe('DiskSessionStore', () => {
  it('creates a session and persists to disk', () => {
    const dir = mkDir();
    const store = new DiskSessionStore({ dir, debounceMs: 0 });
    const s = store.create();
    expect(s.id).toHaveLength(16);
    expect(s.messages).toEqual([]);
    // 重新实例化 store 验证持久化
    const store2 = new DiskSessionStore({ dir, debounceMs: 0 });
    const loaded = store2.get(s.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(s.id);
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves messages and readFiles correctly', () => {
    const dir = mkDir();
    const store = new DiskSessionStore({ dir, debounceMs: 0 });
    const s = store.create();
    s.messages.push({ role: 'user', content: 'hello' });
    s.messages.push({ role: 'assistant', content: 'hi there' });
    s.readFiles.add('/tmp/a.ts');
    store.save(s);
    // 重新加载
    const loaded = store.get(s.id)!;
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe('hello');
    expect(loaded.readFiles.has('/tmp/a.ts')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists sessions sorted by lastActiveAt desc', async () => {
    const dir = mkDir();
    const store = new DiskSessionStore({ dir, debounceMs: 0 });
    const s1 = store.create();
    s1.messages.push({ role: 'user', content: 'first session' });
    store.save(s1);
    // 等待确保时间戳不同
    await new Promise(r => setTimeout(r, 20));
    const s2 = store.create();
    s2.messages.push({ role: 'user', content: 'second session' });
    store.save(s2);
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(s2.id); // 最新的在前
    expect(list[0].firstUserMessage).toBe('second session');
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes a session', () => {
    const dir = mkDir();
    const store = new DiskSessionStore({ dir, debounceMs: 0 });
    const s = store.create();
    expect(store.get(s.id)).toBeDefined();
    store.delete(s.id);
    expect(store.get(s.id)).toBeUndefined();
    expect(store.list()).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined for non-existent id', () => {
    const dir = mkDir();
    const store = new DiskSessionStore({ dir, debounceMs: 0 });
    expect(store.get('nonexistent')).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});
