/**
 * @file HookManager 钩子管理器
 * 管理 Hook 的注册和执行，按优先级排序，支持中止操作
 */
import type { Hook, HookPoint, HookContext, HookData } from './types.js';
import type { Session } from '../session/types.js';

/**
 * HookManager 管理所有注册的 hooks
 * 提供按挂载点触发执行的能力
 */
export class HookManager {
  private hooks: Hook[] = [];

  /** 注册一个 hook */
  register(hook: Hook): void {
    this.hooks.push(hook);
    // 按优先级排序（数字小的先执行）
    this.hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /** 批量注册 hooks */
  registerAll(hooks: Hook[]): void {
    for (const h of hooks) this.register(h);
  }

  /** 移除指定名称的 hook */
  remove(name: string): void {
    this.hooks = this.hooks.filter(h => h.name !== name);
  }

  /** 获取所有已注册的 hooks */
  list(): Hook[] {
    return [...this.hooks];
  }

  /**
   * 在指定挂载点执行所有匹配的 hooks
   * 按优先级顺序串行执行，任何 hook 调用 abort() 后停止后续 hook
   * @returns 是否被中止
   */
  async run(point: HookPoint, session: Session, data: HookData): Promise<boolean> {
    const matching = this.hooks.filter(h => h.point === point);
    if (matching.length === 0) return false;

    let aborted = false;
    const ctx: HookContext = {
      point,
      session,
      data,
      abort: () => { aborted = true; },
      get aborted() { return aborted; },
    };

    for (const hook of matching) {
      if (aborted) break;
      await hook.handler(ctx);
    }

    return aborted;
  }

  /** 同步检查是否有指定挂载点的 hooks */
  has(point: HookPoint): boolean {
    return this.hooks.some(h => h.point === point);
  }
}
