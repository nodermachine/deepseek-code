/**
 * @file REPL 交互式循环
 * 支持斜杠命令（/model、/help、/clear、/sessions 等），类似 Claude Code 交互风格
 * 输入 / 后实时显示命令建议列表（无需按 Tab）
 * ESC 取消当前 turn，Ctrl+C 也取消当前 turn，Ctrl+D 退出
 */
import { createInterface, type CompleterResult, type Interface as RLInterface } from 'node:readline';
import { emitKeypressEvents } from 'node:readline';
import pc from 'picocolors';
import type { Session, SessionStore, SkillRegistry, Config } from '@deepseek-code/core';

export interface ReplDeps {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  runTurn: (input: string, session: Session, signal: AbortSignal) => Promise<number>;
  session: Session;
  /** 可变的当前模型名（斜杠命令可修改） */
  getModel: () => string;
  setModel: (m: string) => void;
  /** session store（用于 /sessions 命令） */
  sessionStore?: SessionStore;
  /** Skills 注册表（用于 /skills 命令） */
  skillRegistry?: SkillRegistry;
  /** 当前生效配置（用于 /config 命令） */
  config?: Config;
  /** 配置来源信息（用于 /config 命令） */
  configSources?: Record<string, string>;
}

/** 可用的斜杠命令定义 */
const SLASH_COMMANDS: Record<string, string> = {
  '/help':     '显示可用命令列表',
  '/model':    '查看或切换模型（/model deepseek-v4-flash）',
  '/config':   '显示当前配置及来源',
  '/plan':     '进入规划模式（/plan <prompt>）',
  '/skills':   '列出可用技能',
  '/clear':    '清空当前会话历史',
  '/sessions': '列出历史会话',
  '/compact':  '手动触发历史压缩',
  '/quit':     '退出 REPL',
};

/** 可选模型列表，用于 /model 补全 */
const MODEL_OPTIONS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

/**
 * 创建 Tab 补全函数（闭包，携带 skillRegistry）
 * 支持：斜杠命令补全、/model 后补全模型名、/skills/ 后补全技能名
 */
function createCompleter(skillRegistry?: SkillRegistry): (line: string) => CompleterResult {
  return (line: string): CompleterResult => {
    const trimmed = line.trimStart();

    // /model <tab> → 补全模型名
    if (trimmed.startsWith('/model ')) {
      const partial = trimmed.slice(7);
      const hits = MODEL_OPTIONS.filter(m => m.startsWith(partial));
      return [hits.length ? hits.map(h => `/model ${h}`) : MODEL_OPTIONS.map(h => `/model ${h}`), line];
    }

    // /skills/ <tab> → 补全技能名
    if (trimmed.startsWith('/skills/') && skillRegistry) {
      const partial = trimmed.slice(8); // "/skills/" 后的内容
      const skillNames = skillRegistry.list().map(s => s.name);
      const hits = skillNames.filter(n => n.startsWith(partial));
      const options = hits.length ? hits : skillNames;
      return [options.map(n => `/skills/${n}`), line];
    }

    // / 开头 → 补全斜杠命令
    if (trimmed.startsWith('/')) {
      const commands = Object.keys(SLASH_COMMANDS);
      const hits = commands.filter(c => c.startsWith(trimmed));
      return [hits.length ? hits : commands, line];
    }

    return [[], line];
  };
}

/**
 * 实时建议渲染器
 * 监听按键事件，在输入 / 开头时自动在下方渲染匹配的命令/技能建议
 * 使用 ANSI 转义码在不干扰输入行的情况下绘制/清除建议区域
 */
class SuggestionRenderer {
  private lastSugLines = 0;
  private stdout: NodeJS.WritableStream;
  private rl: RLInterface;
  private skillRegistry?: SkillRegistry;

  constructor(stdout: NodeJS.WritableStream, rl: RLInterface, skillRegistry?: SkillRegistry) {
    this.stdout = stdout;
    this.rl = rl;
    this.skillRegistry = skillRegistry;
  }

  /** 根据当前输入内容更新建议显示 */
  update(line: string): void {
    const trimmed = line.trimStart();
    let suggestions: Array<{ cmd: string; desc: string }> = [];

    if (trimmed.startsWith('/model ')) {
      // /model 后显示模型选项
      const partial = trimmed.slice(7);
      suggestions = MODEL_OPTIONS
        .filter(m => m.startsWith(partial))
        .map(m => ({ cmd: `/model ${m}`, desc: '' }));
    } else if (trimmed.startsWith('/skills/')) {
      // /skills/ 后显示可用技能名称
      const partial = trimmed.slice(8);
      if (this.skillRegistry) {
        suggestions = this.skillRegistry.list()
          .filter(s => s.name.startsWith(partial))
          .map(s => ({ cmd: `/skills/${s.name}`, desc: s.description }));
      }
    } else if (trimmed.startsWith('/')) {
      // / 开头显示匹配的命令
      suggestions = Object.entries(SLASH_COMMANDS)
        .filter(([k]) => k.startsWith(trimmed))
        .map(([k, v]) => ({ cmd: k, desc: v }));
    }

    this.render(suggestions);
  }

  /** 清除建议区域 */
  clear(): void {
    this.render([]);
  }

  /** 使用 ANSI 转义码渲染建议列表到输入行下方 */
  private render(suggestions: Array<{ cmd: string; desc: string }>): void {
    const out = this.stdout as NodeJS.WriteStream;
    if (!out.isTTY) return;

    // 先清除之前的建议行
    if (this.lastSugLines > 0) {
      out.write('\x1b[s');
      for (let i = 0; i < this.lastSugLines; i++) {
        out.write('\x1b[B');
        out.write('\x1b[2K');
      }
      out.write('\x1b[u');
    }

    this.lastSugLines = suggestions.length;

    if (suggestions.length === 0) return;

    // 保存光标，在下方渲染建议（纯文本，不加颜色）
    out.write('\x1b[s');
    for (const { cmd, desc } of suggestions) {
      out.write('\x1b[B');
      out.write('\x1b[2K');
      out.write('\x1b[G');
      const label = desc ? `  ${cmd.padEnd(20)} ${desc}` : `  ${cmd}`;
      out.write(label);
    }
    out.write('\x1b[u');
  }
}

export async function startRepl(deps: ReplDeps): Promise<number> {
  const { stdin, stdout, session, runTurn, getModel, setModel, sessionStore, skillRegistry, config, configSources } = deps;
  const rl = createInterface({
    input: stdin as NodeJS.ReadableStream,
    output: stdout,
    terminal: true,
    prompt: pc.cyan('> '),
    completer: createCompleter(skillRegistry),
  });
  let lastExit = 0;
  let activeAbort: AbortController | null = null;

  // 实时建议渲染器（携带 skillRegistry 用于 /skills/ 建议）
  const suggester = new SuggestionRenderer(stdout, rl, skillRegistry);

  // 监听按键事件，实时显示命令建议 + ESC 打断
  if ((stdin as NodeJS.ReadStream).isTTY) {
    emitKeypressEvents(stdin as NodeJS.ReadableStream, rl);
    // 延迟一个 tick 监听，避免和 readline 内部冲突
    process.nextTick(() => {
      (stdin as NodeJS.ReadStream).on('keypress', (_str: string, key: any) => {
        // ESC 打断当前对话
        if (key && key.name === 'escape') {
          suggester.clear();
          if (activeAbort) {
            activeAbort.abort();
            activeAbort = null;
            stdout.write('\n' + pc.gray('已按 ESC 打断本轮对话') + '\n');
            // 不在这里调 rl.prompt()，避免与 for await 循环中的 prompt 冲突
          }
          return;
        }

        // 原有的建议渲染逻辑
        const currentLine: string = (rl as any).line ?? '';
        if (currentLine.startsWith('/')) {
          suggester.update(currentLine);
        } else {
          suggester.clear();
        }
      });
    });
  }

  // Ctrl+C 取消当前 turn 或退出
  rl.on('SIGINT', () => {
    suggester.clear();
    if (activeAbort) {
      activeAbort.abort();
    } else {
      stdout.write('\n');
      rl.close();
    }
  });

  // 启动提示
  stdout.write(pc.gray(`deepseek-code v0.3 | 模型: ${getModel()} | 输入 /help 查看命令\n\n`));
  rl.prompt();

  for await (const line of rl) {
    // 提交时清除建议
    suggester.clear();

    const input = (line as string).trim();
    if (!input) { rl.prompt(); continue; }

    // 处理斜杠命令
    if (input.startsWith('/')) {
      // /skills/<name> <prompt> → 激活指定 skill 并将内容作为上下文传给 agent
      const skillMatch = input.match(/^\/skills\/([^\s]+)(?:\s+(.*))?$/);
      if (skillMatch && skillRegistry) {
        const [, skillName, prompt] = skillMatch;
        const skill = skillRegistry.getByCommand(skillName) ?? skillRegistry.list().find(s => s.name === skillName);
        if (skill) {
          stdout.write(pc.gray(`→ 已加载技能: ${skill.description}\n`));
          const enriched = `[Skill: ${skill.name}]\n${skill.content}\n\n---\n${prompt || '请按以上技能指引执行'}`;
          activeAbort = new AbortController();
          lastExit = await runTurn(enriched, session, activeAbort.signal);
          activeAbort = null;
          rl.prompt();
          continue;
        } else {
          stdout.write(pc.red(`未找到技能: ${skillName}\n`));
          rl.prompt();
          continue;
        }
      }

      const handled = handleSlashCommand(input, { stdout, session, getModel, setModel, sessionStore, skillRegistry, config, configSources });
      if (handled === 'quit') { rl.close(); break; }
      if (handled) { rl.prompt(); continue; }
      // 未识别的斜杠命令（如 /plan）会传给 runTurn 处理
    }

    activeAbort = new AbortController();
    lastExit = await runTurn(input, session, activeAbort.signal);
    activeAbort = null;
    rl.prompt();
  }
  return lastExit;
}

/** 处理内置斜杠命令，返回 true 表示已处理，'quit' 表示退出，false 表示传给 agent */
function handleSlashCommand(
  input: string,
  ctx: { stdout: NodeJS.WritableStream; session: Session; getModel: () => string; setModel: (m: string) => void; sessionStore?: SessionStore; skillRegistry?: SkillRegistry; config?: Config; configSources?: Record<string, string> },
): boolean | 'quit' {
  const [cmd, ...args] = input.split(/\s+/);

  switch (cmd) {
    case '/help':
      ctx.stdout.write(pc.bold('\n可用命令：\n'));
      for (const [k, v] of Object.entries(SLASH_COMMANDS)) {
        ctx.stdout.write(`  ${pc.cyan(k.padEnd(12))} ${v}\n`);
      }
      ctx.stdout.write(pc.bold('\n快捷键：\n'));
      ctx.stdout.write(`  ${pc.cyan('ESC'.padEnd(12))} 打断本轮对话（同 Ctrl+C）\n`);
      ctx.stdout.write(`  ${pc.cyan('Ctrl+C'.padEnd(12))} 打断本轮对话（无对话时退出）\n`);
      ctx.stdout.write(`  ${pc.cyan('Ctrl+D'.padEnd(12))} 退出 REPL\n`);
      ctx.stdout.write('\n');
      return true;

    case '/model':
      if (args.length === 0) {
        ctx.stdout.write(`当前模型: ${pc.green(ctx.getModel())}\n`);
        ctx.stdout.write(pc.gray('可选: deepseek-v4-flash, deepseek-chat, deepseek-reasoner\n'));
      } else {
        ctx.setModel(args[0]);
        ctx.stdout.write(`已切换模型为: ${pc.green(args[0])}\n`);
      }
      return true;

    case '/clear':
      // 保留 system message，清除其他
      const sysMsg = ctx.session.messages.find(m => m.role === 'system');
      ctx.session.messages = sysMsg ? [sysMsg] : [];
      ctx.session.readFiles.clear();
      ctx.stdout.write(pc.gray('已清空会话历史\n'));
      return true;

    case '/sessions':
      if (ctx.sessionStore) {
        const list = ctx.sessionStore.list();
        if (list.length === 0) {
          ctx.stdout.write('暂无历史会话\n');
        } else {
          ctx.stdout.write(`\n共 ${list.length} 个会话：\n`);
          for (const s of list.slice(0, 10)) {
            const date = new Date(s.lastActiveAt).toLocaleString('zh-CN');
            ctx.stdout.write(`  ${pc.dim(s.id)}  ${date}  [${s.messageCount}条]  ${s.firstUserMessage.slice(0, 40)}\n`);
          }
          ctx.stdout.write(pc.gray('\n使用 deepseek --resume <id> 恢复会话\n'));
        }
      } else {
        ctx.stdout.write('会话存储不可用\n');
      }
      return true;

    case '/config':
      if (ctx.config && ctx.configSources) {
        ctx.stdout.write(pc.bold('\n当前配置：\n'));
        const entries = Object.entries(ctx.config).filter(([k]) => k !== 'mcpServers');
        for (const [key, value] of entries) {
          const source = ctx.configSources[key] ?? 'default';
          const sourceTag = source === 'env' ? pc.yellow(`[${source}]`)
            : source === 'project' ? pc.blue(`[${source}]`)
            : source === 'user' ? pc.green(`[${source}]`)
            : pc.dim(`[${source}]`);
          const displayVal = key === 'apiKey' ? `${String(value).slice(0, 6)}...` : String(value);
          ctx.stdout.write(`  ${pc.cyan(key.padEnd(16))} ${displayVal.padEnd(30)} ${sourceTag}\n`);
        }
        // MCP servers
        if (ctx.config.mcpServers && Object.keys(ctx.config.mcpServers).length > 0) {
          ctx.stdout.write(pc.bold('\nMCP Servers：\n'));
          for (const [name, srv] of Object.entries(ctx.config.mcpServers)) {
            ctx.stdout.write(`  ${pc.cyan(name.padEnd(16))} ${srv.type} ${srv.command ?? srv.url ?? ''}\n`);
          }
        }
        ctx.stdout.write('\n');
      } else {
        ctx.stdout.write(pc.gray('配置信息不可用\n'));
      }
      return true;

    case '/compact':
      ctx.stdout.write(pc.gray('请在下一轮对话时自动触发压缩，或使用较长对话自然触发。\n'));
      return true;

    case '/skills':
      if (ctx.skillRegistry) {
        const skills = ctx.skillRegistry.list();
        if (skills.length === 0) {
          ctx.stdout.write('暂无已加载的技能\n');
          ctx.stdout.write(pc.gray('在 .deepseek-code/skills/ 目录下创建 .md 文件即可\n'));
        } else {
          ctx.stdout.write(pc.bold(`\n已加载 ${skills.length} 个技能：\n`));
          for (const s of skills) {
            const trigger = s.trigger.type === 'always' ? '常驻' : s.trigger.type === 'auto' ? '自动' : `/${s.trigger.type === 'command' ? s.trigger.name : s.name}`;
            ctx.stdout.write(`  ${pc.cyan(s.name.padEnd(16))} ${pc.dim(`[${trigger}]`)} ${s.description}\n`);
          }
          ctx.stdout.write('\n');
        }
      } else {
        ctx.stdout.write('Skills 未初始化\n');
      }
      return true;

    case '/quit':
    case '/exit':
      return 'quit';

    default:
      // /plan 等命令传给 runTurn 处理
      return false;
  }
}
