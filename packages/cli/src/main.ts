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
  DeepseekProvider, DeepseekCodeError,
  buildSystemPrompt, SkillRegistry, HookManager, VERSION, lintSkills,
} from '@deepseek-code/core';
import type { Session } from '@deepseek-code/core';
import { readTool, grepTool, bashTool, editTool, writeTool, globTool, webFetchTool, todoWriteTool, multiEditTool } from '@deepseek-code/tools';
import { makeAskPermission, makeHeadlessPermission } from './permission-prompt.js';
import type { TrustLevel } from './permission-prompt.js';
import { runLogin } from './login.js';
import { startRepl } from './repl.js';
import { handleInstall, handleUninstall } from './install.js';
import { handleSyncSkills } from './sync-skills.js';
import { createDefaultHooks } from './hooks/defaults.js';
import { executeTurn } from './run-turn.js';
import type { RunTurnDeps, TurnOpts } from './run-turn.js';

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
    .option('--last', '恢复最近一次会话', false)
    .option('--plan', '规划模式：先生成计划，确认后再执行', false)
    .option('--dry-run', '编辑预览模式：显示 diff 但不实际写入', false)
    .option('--headless', '无头模式：禁用交互，用于 CI/CD 集成', false)
    .option('--trust <level>', '信任级别 (none|tools|full)，仅 headless 模式有效', 'tools')
    .option('--no-tui', '禁用 Ink TUI，使用纯文本输出');

  // === 子命令注册（用 commander 标准方式，避免 argv.includes 误命中） ===
  let subCommandRan = false;
  // 给主命令添加默认 action，阻止 commander 在无参数时自动显示 help
  program.action(() => { /* 默认：无子命令时 fall-through 到下方 REPL/单次任务逻辑 */ });

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
  const opts = program.opts<{ model?: string; debug: boolean; cwd: string; resume?: string; last: boolean; plan: boolean; dryRun: boolean; headless: boolean; trust: string; tui: boolean }>();
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

  // 注册工具（9 个）
  const registry = new ToolRegistry();
  registry.register(readTool);
  registry.register(grepTool);
  registry.register(bashTool);
  registry.register(editTool);
  registry.register(writeTool);
  registry.register(globTool);
  registry.register(webFetchTool);
  registry.register(todoWriteTool);
  registry.register(multiEditTool);

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
  } else if (opts.last) {
    // --last：恢复最近一次会话
    const list = sessionStore.list();
    if (list.length === 0) {
      process.stderr.write('暂无历史会话，创建新会话\n');
      session = sessionStore.create();
    } else {
      const latest = sessionStore.get(list[0].id);
      if (!latest) { session = sessionStore.create(); }
      else {
        session = latest;
        process.stderr.write(`已恢复最近会话 ${session.id}（${session.messages.length} 条消息）\n`);
      }
    }
  } else {
    session = sessionStore.create();
  }

  const logger = opts.debug
    ? new JsonlLogger(join(homedir(), '.deepseek-code', 'logs', `session-${session.id}.jsonl`))
    : new NullLogger();
  const provider = new DeepseekProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  // headless 模式：权限自动决策；否则交互式确认
  const ask = opts.headless
    ? makeHeadlessPermission(opts.trust as TrustLevel)
    : makeAskPermission(process.stdin, process.stdout);

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

  // 构建 system prompt（含 DEEPSEEK.md + always-on skills + skill catalog）
  const systemPrompt = buildSystemPrompt({ cwd, skills: alwaysOnSkills, allSkills: skillRegistry.list(), model });
  
  // Plan mode 确认回调
  const confirmPlan = async () => {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write('\n执行此计划？[y/n/修改指令]: ');
    const answer: string = await new Promise(res => rl.question('', a => { rl.close(); res(a.trim()); }));
    if (answer === 'n' || answer === 'N') return { confirmed: false };
    if (answer === 'y' || answer === 'Y' || answer === '') return { confirmed: true };
    return { confirmed: true, modification: answer };
  };
  
  // 构建 runTurn 依赖对象（显式注入，不依赖闭包捕获）
  const turnDeps: RunTurnDeps = {
    provider, registry, permission, session, sessionStore, logger,
    askPermission: ask, skillRegistry, hooks: hookManager,
    config, systemPrompt, currentModel,
    globalPlanMode: opts.plan,
    useTui: opts.tui && !!process.stdout.isTTY,
    dryRun: opts.dryRun,
    confirmPlan,
  };
  
  const runTurn = async (
    input: string,
    _sess = session,
    signal?: AbortSignal,
    turnOpts?: TurnOpts,
  ): Promise<number> => {
    // 同步 currentModel 到 deps（可能被 /model 命令动态切换）
    turnDeps.currentModel = currentModel;
    return executeTurn(input, turnDeps, signal, turnOpts);
  };

  // 进程退出前强制 flush，保证最后一次 debounce 写入
  process.on('exit', () => sessionStore.flush(session));

  // headless 模式或有 prompt 参数 → 单次任务；否则进 REPL
  if (args.length === 0 && !opts.headless) {
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
  if (!promptText && opts.headless) {
    process.stderr.write('headless 模式需要提供 prompt 参数\n');
    return 1;
  }
  // 单次任务模式：headless 不显示颜色
  if (!opts.headless) {
    process.stdout.write(pc.green('┃ You: ') + pc.white(promptText) + '\n\n');
  }
  return runTurn(promptText);
}

main(process.argv).then((code) => process.exit(code));

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
