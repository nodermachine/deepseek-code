/**
 * @file CLI 入口
 * commander 解析命令行参数，组装全部依赖，启动 REPL 或单次任务模式
 * 阶段三新增：SkillRegistry、工具并行执行
 */
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import {
  loadConfig, getConfigSources, JsonlLogger, NullLogger,
  ToolRegistry, PermissionEngine, DiskSessionStore,
  runAgentLoop, DeepseekProvider, DeepseekCodeError,
  buildSystemPrompt, needsCompact, compactMessages,
  runPlanMode, SkillRegistry, HookManager, VERSION, lintSkills,
} from '@deepseek-code/core';
import type { Session } from '@deepseek-code/core';
import { readTool, grepTool, bashTool, editTool, writeTool, globTool, webFetchTool, todoWriteTool } from '@deepseek-code/tools';
import { renderAgentStream } from './render/stream.js';
import { renderWithInk } from './ui/App.js';
import { makeAskPermission } from './permission-prompt.js';
import { runLogin } from './login.js';
import { startRepl } from './repl.js';
import { handleInstall, handleUninstall } from './install.js';
import { handleSyncSkills } from './sync-skills.js';
import { createDefaultHooks } from './hooks/defaults.js';

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('deepseek')
    .version(VERSION)
    .argument('[prompt...]', '一次性任务输入')
    .option('--model <name>', 'DeepSeek 模型', undefined)
    .option('--debug', '写入 JSONL 日志', false)
    .option('--cwd <path>', '工作目录', process.cwd())
    .option('--resume <id>', '恢复指定会话继续对话')
    .option('--plan', '规划模式：先生成计划，确认后再执行', false)
    .option('--no-tui', '禁用 Ink TUI，使用纯文本输出');

  // === 子命令注册（用 commander 标准方式，避免 argv.includes 误命中） ===
  let subCommandRan = false;

  program.command('login')
    .description('登录并保存 API Key')
    .action(async () => {
      subCommandRan = true;
      await runLogin(process.stdin, process.stdout);
    });

  program.command('sessions')
    .description('管理历史会话')
    .argument('[action]', 'rm')
    .argument('[id]', '会话 ID')
    .action(async (action?: string, id?: string) => {
      subCommandRan = true;
      handleSessions(action, id);
    });

  program.command('install')
    .description('安装技能包')
    .argument('[source]', '来源（GitHub URL 等）')
    .allowUnknownOption(true)
    .action(async () => {
      subCommandRan = true;
      await handleInstall(argv);
    });

  program.command('uninstall')
    .description('卸载技能包')
    .argument('[name]', '技能名')
    .allowUnknownOption(true)
    .action(async () => {
      subCommandRan = true;
      await handleUninstall(argv);
    });

  program.command('sync-skills')
    .description('同步 ~/.claude/skills/ 到 ~/.deepseek-code/skills/')
    .action(async () => {
      subCommandRan = true;
      await handleSyncSkills(argv);
    });

  program.parse(argv);
  if (subCommandRan) return 0;
  const opts = program.opts<{ model?: string; debug: boolean; cwd: string; resume?: string; plan: boolean; tui: boolean }>();
  const args = program.args;

  const cwd = resolve(opts.cwd);
  process.chdir(cwd);

  let config;
  let configSources: Record<string, string> = {};
  try {
    config = loadConfig({ cwd });
    configSources = getConfigSources({ cwd });
  } catch (e) {
    if (e instanceof DeepseekCodeError) { process.stderr.write(e.userMessage + '\n'); return 1; }
    throw e;
  }
  const model = opts.model ?? config.model;
  let currentModel = model; // 可通过 /model 命令动态切换

  // 注册工具（8 个）
  const registry = new ToolRegistry();
  registry.register(readTool);
  registry.register(grepTool);
  registry.register(bashTool);
  registry.register(editTool);
  registry.register(writeTool);
  registry.register(globTool);
  registry.register(webFetchTool);
  registry.register(todoWriteTool);

  const permission = new PermissionEngine({
    // 默认放行所有工具操作（危险命令由 blacklist + danger-guard hook 兆底）
    globalRules: [
      { tool: 'Write', matcher: '*', decision: 'allow' },
      { tool: 'Edit', matcher: '*', decision: 'allow' },
      { tool: 'Bash', matcher: '*', decision: 'allow' },
    ],
    // 敏感路径：编辑关键文件时强制确认（即使全局 allow）
    sensitivePaths: config.sensitivePaths,
  });
  const sessionStore = new DiskSessionStore();

  // 恢复或创建会话
  let session: Session;
  if (opts.resume) {
    const existing = sessionStore.get(opts.resume);
    if (!existing) {
      process.stderr.write(`会话 ${opts.resume} 不存在\n`);
      return 1;
    }
    session = existing;
    process.stderr.write(`已恢复会话 ${session.id}（${session.messages.length} 条消息）\n`);
  } else {
    session = sessionStore.create();
  }

  const logger = opts.debug
    ? new JsonlLogger(join(homedir(), '.deepseek-code', 'logs', `session-${session.id}.jsonl`))
    : new NullLogger();
  const provider = new DeepseekProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const ask = makeAskPermission(process.stdin, process.stdout);

  // 加载 Skills
  const skillRegistry = new SkillRegistry();
  skillRegistry.loadFromDisk({ cwd });
  const alwaysOnSkills = skillRegistry.getAlwaysOn();

  // Skill lint：检查已加载技能的健全性
  const skillWarnings = lintSkills(skillRegistry.list());
  if (skillWarnings.length > 0) {
    process.stderr.write(pc.yellow(`skills: ${skillRegistry.list().length} loaded, ${skillWarnings.length} warnings \u2014 /skills doctor\n`));
  }

  // 初始化 HookManager 并注册默认钩子
  const hookManager = new HookManager();
  hookManager.registerAll(createDefaultHooks({ logger, stdout: process.stdout, stdin: process.stdin }));

  // 构建 system prompt（含 DEEPSEEK.md + always-on skills）
  const systemPrompt = buildSystemPrompt({ cwd, skills: alwaysOnSkills, model });

  const runTurn = async (
    input: string,
    _sess = session,
    signal?: AbortSignal,
    turnOpts?: { modelOverride?: string; allowedTools?: string[]; attachments?: string[]; usePlan?: boolean; events?: (e: AsyncIterable<any>) => void },
  ): Promise<number> => {
    const ctl = signal ? null : new AbortController();
    const sig = signal ?? ctl!.signal;
    const runModel = turnOpts?.modelOverride ?? currentModel;

    // Compact：如果历史过长则压缩（使用 compactModel 或 flash 节省成本）
    if (needsCompact(session.messages, { model: runModel })) {
      process.stderr.write('正在压缩历史对话...\n');
      const result = await compactMessages(session.messages, provider, sig, {
        model: runModel,
        compactModel: config.compactModel,
      });
      session.messages = result.messages;
      process.stderr.write(`已压缩 ${result.removedCount} 条消息\n`);
    }

    // 拼 attachments 提示
    const attachmentNote = turnOpts?.attachments && turnOpts.attachments.length > 0
      ? `[attached files]\n${turnOpts.attachments.map(a => '- ' + a).join('\n')}\n\n`
      : '';
    const actualInput = attachmentNote + input;

    const usePlan = opts.plan || turnOpts?.usePlan === true;

    let events: AsyncIterable<any>;
    if (usePlan) {
      events = runPlanMode({
        provider, registry, permission, session,
        userInput: actualInput, model: runModel, maxSteps: config.maxSteps,
        signal: sig, logger, askPermission: ask,
        systemPrompt,
        planExecuteModel: config.planExecuteModel,
        confirmPlan: async () => {
          // 简单确认：读一行输入
          const { createInterface } = await import('node:readline');
          const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
          process.stdout.write('\n执行此计划？[y/n/修改指令]: ');
          const answer: string = await new Promise(res => rl.question('', a => { rl.close(); res(a.trim()); }));
          if (answer === 'n' || answer === 'N') return { confirmed: false };
          if (answer === 'y' || answer === 'Y' || answer === '') return { confirmed: true };
          return { confirmed: true, modification: answer };
        },
      });
    } else {
      events = runAgentLoop({
        provider, registry, permission, session,
        userInput: actualInput, model: runModel, maxSteps: config.maxSteps,
        signal: sig, logger, askPermission: ask,
        systemPrompt, skillRegistry, hooks: hookManager,
      });
    }

    // REPL 模式下：把 events 交给持久 Ink 实例，本函数只等 events 消费完
    if (turnOpts?.events) {
      // events 需要被两处消费（Ink UI + 本函数 for-await），复制流
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
      // 中断清理
      if (sig.aborted && session.messages.length > 0) {
        const last = session.messages[session.messages.length - 1];
        if (last.role === 'assistant' && (!last.content || last.content.length === 0)) {
          session.messages.pop();
          const prev = session.messages[session.messages.length - 1];
          if (prev && prev.role === 'user') session.messages.pop();
        }
      }
      sessionStore.save(session);
      return exitCode;
    }

    // 非 REPL 模式：走原有渲染
    const useTui = opts.tui && process.stdout.isTTY;
    const { exitCode } = useTui
      ? await renderWithInk(events)
      : await renderAgentStream(events, process.stdout);
    process.stdout.write('\n');

    // 中断后清理：移除 session 末尾不完整的消息
    // R1/thinking 模型 abort 时可能只有 reasoning 没有 content，需连带 pop 前一条 user
    if (sig.aborted && session.messages.length > 0) {
      const last = session.messages[session.messages.length - 1];
      if (last.role === 'assistant' && (!last.content || last.content.length === 0)) {
        session.messages.pop(); // pop 空 assistant
        // 如果前一条是本轮的 user，也 pop 掉（让用户重发）
        const prev = session.messages[session.messages.length - 1];
        if (prev && prev.role === 'user') {
          session.messages.pop();
        }
      }
    }

    // 每轮结束后持久化会话（debounce，连续工具调用不会频繁写盘）
    sessionStore.save(session);
    return exitCode;
  };

  // 进程退出前强制 flush，保证最后一次 debounce 写入
  process.on('exit', () => sessionStore.flush(session));

  if (args.length === 0) {
    return startRepl({
      stdin: process.stdin,
      stdout: process.stdout,
      session,
      runTurn,
      getModel: () => currentModel,
      setModel: (m) => { currentModel = m; },
      sessionStore,
      skillRegistry,
      config,
      configSources,
      provider,
      cwd,
    });
  }
  const promptText = args.join(' ');
  // 单次任务模式：显示用户输入
  process.stdout.write(pc.green('┃ You: ') + pc.white(promptText) + '\n\n');
  return runTurn(promptText);
}

/** 把一个 AsyncIterable 复制成两个独立消费的流（简单缓冲实现） */
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

/**
 * 处理 sessions 子命令
 * - `deepseek sessions` — 列出历史会话
 * - `deepseek sessions rm <id>` — 删除指定会话
 */
function handleSessions(action?: string, id?: string): number {
  const store = new DiskSessionStore();

  if (action === 'rm' && id) {
    store.delete(id);
    process.stdout.write(`已删除会话 ${id}\n`);
    return 0;
  }

  // 列出所有会话
  const sessions = store.list();
  if (sessions.length === 0) {
    process.stdout.write('暂无历史会话\n');
    return 0;
  }
  process.stdout.write(`共 ${sessions.length} 个会话：\n\n`);
  for (const s of sessions) {
    const date = new Date(s.lastActiveAt).toLocaleString('zh-CN');
    const preview = s.firstUserMessage || '(空)';
    process.stdout.write(`  ${s.id}  ${date}  [${s.messageCount}条]  ${preview}\n`);
  }
  process.stdout.write(`\n使用 deepseek --resume <id> 恢复会话\n`);
  return 0;
}

main(process.argv).then((code) => process.exit(code));
