/**
 * @file runTurn 独立模块
 * 从 main.ts 闭包提取为显式依赖注入的函数，便于单元测试和复用
 */
import type {
  Provider, Session, SessionStore, ToolRegistry, PermissionEngine,
  SkillRegistry, HookManager, Config, AgentEvent,
} from '@deepseek-code/core';
import type { Logger } from '@deepseek-code/core';
import {
  runAgentLoop, runPlanMode, needsCompact, compactMessages, truncateMessages,
  DRY_RUN_SUFFIX,
} from '@deepseek-code/core';
import { renderAgentStream } from './render/stream.js';
import { renderWithInk } from './ui/App.js';
import type { AskPermissionFn } from './permission-prompt.js';

/** runTurn 所需的全部依赖（显式注入，不依赖外部闭包） */
export interface RunTurnDeps {
  provider: Provider;
  registry: ToolRegistry;
  permission: PermissionEngine;
  session: Session;
  sessionStore: SessionStore;
  logger: Logger;
  askPermission: AskPermissionFn;
  skillRegistry?: SkillRegistry;
  hooks?: HookManager;
  config: Config;
  systemPrompt: string;
  currentModel: string;
  /** 全局 plan 模式标志（来自 --plan CLI 选项） */
  globalPlanMode: boolean;
  /** 是否使用 TUI 渲染（来自 --tui + isTTY） */
  useTui: boolean;
  /** --dry-run 模式：工具结果仅显示不写入 */
  dryRun: boolean;
  /** plan 模式确认回调 */
  confirmPlan: () => Promise<{ confirmed: boolean; modification?: string }>;
}

/** 单轮执行选项 */
export interface TurnOpts {
  modelOverride?: string;
  allowedTools?: string[];
  attachments?: string[];
  usePlan?: boolean;
  events?: (e: AsyncIterable<AgentEvent>) => void;
}

/**
 * 执行单轮 Agent 对话
 * 包含：compact 检测 → 模型调用 → 渲染 → session 持久化 → 中断清理
 */
export async function executeTurn(
  input: string,
  deps: RunTurnDeps,
  signal?: AbortSignal,
  turnOpts?: TurnOpts,
): Promise<number> {
  const startTime = Date.now();
  const { provider, registry, permission, session, sessionStore, logger,
    askPermission, skillRegistry, hooks, config, systemPrompt, currentModel,
    globalPlanMode, useTui, dryRun, confirmPlan } = deps;

  const ctl = signal ? null : new AbortController();
  const sig = signal ?? ctl!.signal;
  const runModel = turnOpts?.modelOverride ?? currentModel;

  // dry-run 模式：在 system prompt 末尾追加指令
  const effectivePrompt = dryRun
    ? systemPrompt + DRY_RUN_SUFFIX
    : systemPrompt;

  // Compact：如果历史过长则压缩（静默执行，无提示）
  if (needsCompact(session.messages, { model: runModel })) {
    try {
      const result = await compactMessages(session.messages, provider, sig, {
        model: runModel,
        compactModel: config.compactModel,
      });
      session.messages = result.messages;
    } catch {
      // 摘要生成失败时，回退到轻量截断
      const result = truncateMessages(session.messages, { model: runModel });
      session.messages = result.messages;
    }
  }

  // 拼 attachments 提示
  const attachmentNote = turnOpts?.attachments && turnOpts.attachments.length > 0
    ? `[attached files]\n${turnOpts.attachments.map(a => '- ' + a).join('\n')}\n\n`
    : '';
  const actualInput = attachmentNote + input;

  const usePlan = globalPlanMode || turnOpts?.usePlan === true;

  let events: AsyncIterable<AgentEvent>;
  if (usePlan) {
    events = runPlanMode({
      provider, registry, permission, session,
      userInput: actualInput, model: runModel, maxSteps: config.maxSteps,
      signal: sig, logger, askPermission,
      systemPrompt: effectivePrompt,
      planExecuteModel: config.planExecuteModel,
      confirmPlan,
    });
  } else {
    events = runAgentLoop({
      provider, registry, permission, session,
      userInput: actualInput, model: runModel, maxSteps: config.maxSteps,
      signal: sig, logger, askPermission,
      systemPrompt: effectivePrompt, skillRegistry, hooks,
    });
  }

  // REPL 模式下：把 events 交给持久 Ink 实例
  if (turnOpts?.events) {
    const [uiEvents, drainEvents] = teeAsync(events);
    turnOpts.events(uiEvents);
    let exitCode = 0;
    for await (const ev of drainEvents) {
      if (ev.type === 'done') {
        if (ev.reason === 'fatal' || ev.reason === 'max_steps') exitCode = 1;
        if (ev.reason === 'abort') exitCode = 130;
        break;
      }
    }
    cleanupAbortedSession(session, sig);
    sessionStore.save(session);
    notifyIfLong(startTime);
    return exitCode;
  }

  // 非 REPL 模式：走原有渲染
  const { exitCode } = useTui
    ? await renderWithInk(events)
    : await renderAgentStream(events, process.stdout);
  process.stdout.write('\n');

  // Token 成本摘要（非 REPL 模式下在结束时输出）
  if (session.usage.total_tokens > 0) {
    const hit = session.usage.prompt_cache_hit_tokens ?? 0;
    const total = session.usage.prompt_tokens;
    const cacheRate = total > 0 ? Math.round(hit / total * 100) : 0;
    // DeepSeek V4 flash 定价：input $0.14/Mtok, output $2.19/Mtok, cache hit 1/10
    const inputCost = ((total - hit) * 0.14 + hit * 0.014) / 1_000_000;
    const outputCost = (session.usage.completion_tokens * 2.19) / 1_000_000;
    const costStr = `$${(inputCost + outputCost).toFixed(4)}`;
    process.stderr.write(`  tokens: ${session.usage.total_tokens.toLocaleString()} | ${costStr} | cache: ${cacheRate}%\n`);
  }

  cleanupAbortedSession(session, sig);
  sessionStore.save(session);
  notifyIfLong(startTime);
  return exitCode;
}

/** 中断后清理：移除 session 末尾不完整的消息 */
function cleanupAbortedSession(session: Session, sig: AbortSignal): void {
  if (!sig.aborted || session.messages.length === 0) return;
  const last = session.messages[session.messages.length - 1];
  if (last.role === 'assistant' && (!last.content || last.content.length === 0)) {
    session.messages.pop();
    const prev = session.messages[session.messages.length - 1];
    if (prev && prev.role === 'user') session.messages.pop();
  }
}

/** 长任务通知：耗时 > 30s 时触发 BEL 字符（终端标签闪烁）+ 可选系统通知 */
function notifyIfLong(startTime: number): void {
  const elapsed = Date.now() - startTime;
  if (elapsed < 30_000) return;
  // BEL 字符让终端标签闪烁
  process.stdout.write('\x07');
  // macOS 系统通知（有 terminal-notifier 时）
  try {
    const { execSync } = require('node:child_process');
    const seconds = Math.round(elapsed / 1000);
    execSync(`which terminal-notifier && terminal-notifier -title "deepseek-code" -message "任务完成 (${seconds}s)" -sound default`, { stdio: 'ignore' });
  } catch { /* terminal-notifier 不可用时静默忽略 */ }
}

/** 把一个 AsyncIterable 复制成两个独立消费的流 */
function teeAsync<T>(source: AsyncIterable<T>): [AsyncIterable<T>, AsyncIterable<T>] {
  const bufA: T[] = [];
  const bufB: T[] = [];
  let done = false;
  const waitersA: Array<() => void> = [];
  const waitersB: Array<() => void> = [];
  const notify = (arr: Array<() => void>) => { while (arr.length) arr.shift()!(); };

  (async () => {
    for await (const v of source) {
      bufA.push(v); bufB.push(v);
      notify(waitersA); notify(waitersB);
    }
    done = true;
    notify(waitersA); notify(waitersB);
  })().catch(() => { done = true; notify(waitersA); notify(waitersB); });

  const make = (buf: T[], waiters: Array<() => void>): AsyncIterable<T> => ({
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          while (buf.length === 0 && !done) {
            await new Promise<void>((r) => waiters.push(r));
          }
          if (buf.length > 0) return { value: buf.shift()!, done: false };
          return { value: undefined as any, done: true };
        },
      };
    },
  });

  return [make(bufA, waitersA), make(bufB, waitersB)];
}
