/**
 * @file HookManager 单元测试
 * 测试 Hook 注册、优先级排序、执行、中止
 */
import { describe, it, expect } from 'vitest';
import { HookManager } from '../../src/hooks/manager.js';
import { MemorySessionStore } from '../../src/session/memory.js';
import type { Hook } from '../../src/hooks/types.js';

describe('HookManager', () => {
  it('registers and lists hooks', () => {
    const mgr = new HookManager();
    mgr.register({ name: 'h1', point: 'onDone', handler: async () => {} });
    mgr.register({ name: 'h2', point: 'onError', handler: async () => {} });
    expect(mgr.list()).toHaveLength(2);
  });

  it('executes hooks in priority order', async () => {
    const mgr = new HookManager();
    const order: string[] = [];

    mgr.register({ name: 'low', point: 'onDone', priority: 200, handler: async () => { order.push('low'); } });
    mgr.register({ name: 'high', point: 'onDone', priority: 10, handler: async () => { order.push('high'); } });
    mgr.register({ name: 'mid', point: 'onDone', priority: 100, handler: async () => { order.push('mid'); } });

    const session = new MemorySessionStore().create();
    await mgr.run('onDone', session, { type: 'onDone', reason: 'natural' });

    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('only runs hooks matching the point', async () => {
    const mgr = new HookManager();
    const called: string[] = [];

    mgr.register({ name: 'a', point: 'onDone', handler: async () => { called.push('a'); } });
    mgr.register({ name: 'b', point: 'onError', handler: async () => { called.push('b'); } });

    const session = new MemorySessionStore().create();
    await mgr.run('onDone', session, { type: 'onDone', reason: 'natural' });

    expect(called).toEqual(['a']);
  });

  it('abort stops subsequent hooks', async () => {
    const mgr = new HookManager();
    const called: string[] = [];

    mgr.register({ name: 'first', point: 'beforeToolExecute', priority: 1, handler: async (ctx) => {
      called.push('first');
      ctx.abort(); // 中止
    }});
    mgr.register({ name: 'second', point: 'beforeToolExecute', priority: 2, handler: async () => {
      called.push('second'); // 不应被调用
    }});

    const session = new MemorySessionStore().create();
    const aborted = await mgr.run('beforeToolExecute', session, {
      type: 'beforeToolExecute', toolName: 'Bash', toolId: 'c1', input: {},
    });

    expect(aborted).toBe(true);
    expect(called).toEqual(['first']);
  });

  it('returns false when no hooks match', async () => {
    const mgr = new HookManager();
    const session = new MemorySessionStore().create();
    const aborted = await mgr.run('onError', session, { type: 'onError', error: { code: 'X', userMessage: 'x' } });
    expect(aborted).toBe(false);
  });

  it('remove deletes hook by name', () => {
    const mgr = new HookManager();
    mgr.register({ name: 'x', point: 'onDone', handler: async () => {} });
    mgr.register({ name: 'y', point: 'onDone', handler: async () => {} });
    mgr.remove('x');
    expect(mgr.list()).toHaveLength(1);
    expect(mgr.list()[0].name).toBe('y');
  });

  it('has() checks for hooks at a point', () => {
    const mgr = new HookManager();
    mgr.register({ name: 'a', point: 'onDone', handler: async () => {} });
    expect(mgr.has('onDone')).toBe(true);
    expect(mgr.has('onError')).toBe(false);
  });
});
