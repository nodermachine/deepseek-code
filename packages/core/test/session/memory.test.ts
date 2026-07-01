import { describe, it, expect } from 'vitest';
import { MemorySessionStore } from '../../src/session/memory.js';

describe('MemorySessionStore', () => {
  it('creates a session with unique id', () => {
    const store = new MemorySessionStore();
    const a = store.create();
    const b = store.create();
    expect(a.id).not.toBe(b.id);
    expect(a.messages).toEqual([]);
    expect(a.readFiles).toBeInstanceOf(Set);
    expect(a.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(a.lastActiveAt).toBeInstanceOf(Date);
  });

  it('retrieves session by id', () => {
    const store = new MemorySessionStore();
    const a = store.create();
    expect(store.get(a.id)).toBe(a);
    expect(store.get('nope')).toBeUndefined();
  });

  it('list returns session metas', () => {
    const store = new MemorySessionStore();
    const a = store.create();
    a.messages.push({ role: 'user', content: 'hello world' });
    store.save(a);
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].firstUserMessage).toBe('hello world');
  });

  it('delete removes session', () => {
    const store = new MemorySessionStore();
    const a = store.create();
    store.delete(a.id);
    expect(store.get(a.id)).toBeUndefined();
  });
});
