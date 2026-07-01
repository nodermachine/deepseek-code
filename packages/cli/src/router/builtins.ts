/**
 * @file 内置命令注册与执行
 * 保持向后兼容旧的 /help /model /clear /sessions /config /compact /skills /quit /cancel，
 * 新增 /memory /init /resume。/plan 由 runTurn 消费（此处仅登记以便菜单显示）。
 */
import pc from 'picocolors';
import type { Session, SessionStore, SkillRegistry, Config, Provider } from '@deepseek-code/core';
import { CommandRegistry, compactMessages } from '@deepseek-code/core';

export interface BuiltinCtx {
  session: Session;
  stdout: NodeJS.WritableStream;
  getModel: () => string;
  setModel: (m: string) => void;
  sessionStore?: SessionStore;
  skillRegistry?: SkillRegistry;
  config?: Config;
  configSources?: Record<string, string>;
  provider?: Provider;
  cwd: string;
  registry: CommandRegistry;
  flashStatus: (msg: string) => void;
}

const BUILTINS: Array<{ name: string; description: string; argumentHint?: string }> = [
  { name: 'help', description: '显示可用命令列表' },
  { name: 'model', description: '查看或切换模型', argumentHint: '<name>' },
  { name: 'config', description: '显示当前配置及来源' },
  { name: 'plan', description: '进入规划模式', argumentHint: '<prompt>' },
  { name: 'skills', description: '列出可用技能' },
  { name: 'clear', description: '清空当前会话历史' },
  { name: 'sessions', description: '列出历史会话' },
  { name: 'compact', description: '手动触发历史压缩' },
  { name: 'memory', description: '打开 DEEPSEEK.md 编辑', argumentHint: '[user]' },
  { name: 'init', description: '初始化项目配置（DEEPSEEK.md + commands 目录）' },
  { name: 'resume', description: 'REPL 内切换会话', argumentHint: '<id>' },
  { name: 'quit', description: '退出 REPL' },
];

export function registerBuiltins(registry: CommandRegistry): void {
  for (const e of BUILTINS) {
    registry.registerBuiltin({
      name: e.name,
      description: e.description,
      argumentHint: e.argumentHint,
      body: '',
      source: 'builtin',
    });
  }
}

export async function runBuiltin(
  name: string,
  args: string,
  ctx: BuiltinCtx,
): Promise<'quit' | void> {
  const w = (s: string) => ctx.stdout.write(s);
  switch (name) {
    case 'help': {
      w(pc.bold('\n可用命令：\n'));
      const groups: Record<string, string[]> = { builtin: [], project: [], user: [], skill: [] };
      for (const c of ctx.registry.list()) {
        const label = '/' + c.name;
        groups[c.source].push(`  ${pc.cyan(label.padEnd(20))} ${c.description}`);
      }
      const labels: Record<string, string> = {
        builtin: '内置', project: '项目命令', user: '用户命令', skill: '技能命令',
      };
      for (const key of Object.keys(groups)) {
        if (groups[key].length === 0) continue;
        w(pc.gray(`\n[${labels[key]}]\n`));
        for (const l of groups[key]) w(l + '\n');
      }
      w('\n' + pc.gray('快捷键：ESC 中断 · Ctrl+C 中断/退出 · Ctrl+D 退出 · ↑↓ 历史/菜单\n\n'));
      return;
    }
    case 'model': {
      if (!args) {
        w(`当前模型: ${pc.green(ctx.getModel())}\n`);
        w(pc.gray('可选: deepseek-v4-flash, deepseek-chat, deepseek-reasoner\n'));
      } else {
        ctx.setModel(args.trim());
        w(`已切换模型为: ${pc.green(args.trim())}\n`);
      }
      return;
    }
    case 'config': {
      if (!ctx.config || !ctx.configSources) { w(pc.gray('配置信息不可用\n')); return; }
      w(pc.bold('\n当前配置：\n'));
      for (const [key, value] of Object.entries(ctx.config).filter(([k]) => k !== 'mcpServers')) {
        const src = ctx.configSources[key] ?? 'default';
        const display = key === 'apiKey' ? `${String(value).slice(0, 6)}...` : String(value);
        w(`  ${pc.cyan(key.padEnd(16))} ${display.padEnd(30)} ${pc.dim('[' + src + ']')}\n`);
      }
      if (ctx.config.mcpServers && Object.keys(ctx.config.mcpServers).length > 0) {
        w(pc.bold('\nMCP Servers：\n'));
        for (const [n, srv] of Object.entries(ctx.config.mcpServers)) {
          w(`  ${pc.cyan(n.padEnd(16))} ${srv.type} ${srv.command ?? srv.url ?? ''}\n`);
        }
      }
      w('\n');
      return;
    }
    case 'clear': {
      const sys = ctx.session.messages.find((m) => m.role === 'system');
      ctx.session.messages = sys ? [sys] : [];
      ctx.session.readFiles.clear();
      ctx.flashStatus('✓ 会话已清空');
      return;
    }
    case 'sessions': {
      if (!ctx.sessionStore) { w('会话存储不可用\n'); return; }
      const list = ctx.sessionStore.list();
      if (list.length === 0) { w('暂无历史会话\n'); return; }
      w(`\n共 ${list.length} 个会话：\n`);
      for (const s of list.slice(0, 10)) {
        w(`  ${pc.dim(s.id)}  ${new Date(s.lastActiveAt).toLocaleString('zh-CN')}  [${s.messageCount}条]  ${s.firstUserMessage.slice(0, 40)}\n`);
      }
      w(pc.gray('\n提示: /resume <id> 可在 REPL 内切会话\n\n'));
      return;
    }
    case 'compact': {
      if (!ctx.provider) { w(pc.gray('provider 不可用，跳过\n')); return; }
      const before = ctx.session.messages.length;
      const ctrl = new AbortController();
      w(pc.gray('压缩中...\n'));
      const result = await compactMessages(ctx.session.messages, ctx.provider, ctrl.signal, {
        model: ctx.getModel(),
        compactModel: ctx.config?.compactModel,
      });
      ctx.session.messages = result.messages;
      w(pc.gray(`已压缩 ${result.removedCount} 条消息（${before} → ${ctx.session.messages.length}）\n`));
      return;
    }
    case 'skills': {
      if (!ctx.skillRegistry) { w('Skills 未初始化\n'); return; }
      const skills = ctx.skillRegistry.list();
      w(pc.bold(`\n已加载 ${skills.length} 个技能：\n`));
      for (const s of skills) {
        const trig = s.trigger.type === 'always' ? '常驻'
          : s.trigger.type === 'auto' ? '自动'
          : `/skills/${s.name}`;
        w(`  ${pc.cyan(s.name.padEnd(28))} ${pc.dim('[' + trig + ']')} ${s.description}\n`);
      }
      w('\n');
      return;
    }
    case 'plan': {
      w(pc.gray('提示：/plan <prompt> 会走 plan mode；从菜单选中后 Enter 提交即可。\n'));
      return;
    }
    case 'memory': {
      const path = await import('node:path');
      const os = await import('node:os');
      const target = args.trim() === 'user'
        ? path.join(os.homedir(), '.deepseek-code', 'DEEPSEEK.md')
        : path.join(ctx.cwd, 'DEEPSEEK.md');
      const editor = process.env.EDITOR ?? 'vi';
      const { spawn } = await import('node:child_process');
      await new Promise<void>((res) => {
        const child = spawn(editor, [target], { stdio: 'inherit' });
        child.on('exit', () => res());
      });
      w(pc.gray(`已保存至 ${target}\n`));
      return;
    }
    case 'init': {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const readline = await import('node:readline');
      let created = 0;

      // 1. 生成 DEEPSEEK.md（项目级记忆文件）
      const mdPath = path.join(ctx.cwd, 'DEEPSEEK.md');
      const mdPathAlt = path.join(ctx.cwd, '.deepseek-code', 'DEEPSEEK.md');
      if (!fs.existsSync(mdPath) && !fs.existsSync(mdPathAlt)) {
        w(pc.bold('\n初始化项目 DEEPSEEK.md\n'));
        w(pc.gray('回答 3 个问题帮助 Agent 更好地理解项目（直接回车跳过）\n\n'));

        const ask = (q: string): Promise<string> => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
        };

        const lang = await ask(pc.cyan('1. 项目使用什么语言/框架？ '));
        const conventions = await ask(pc.cyan('2. Agent 绝对不能违反的规范？ '));
        const confusing = await ask(pc.cyan('3. 代码中容易让人困惑的地方？ '));

        const lines: string[] = ['# DEEPSEEK.md', '', '> 此文件帮助 deepseek-code 理解项目背景。Agent 每次启动时自动注入 system prompt。', ''];
        if (lang) lines.push(`## 技术栈`, '', lang, '');
        if (conventions) lines.push(`## 不可违反的规范`, '', conventions, '');
        if (confusing) lines.push(`## 需要注意的坑`, '', confusing, '');
        if (!lang && !conventions && !confusing) {
          lines.push('## 项目约定', '', '<!-- 在此添加项目规范、命名约定、架构决策等 -->', '');
        }
        lines.push('', '---', '', '> 使用 `/memory` 命令编辑此文件，或用 `#memory 内容` 快速追加。', '');

        fs.writeFileSync(mdPath, lines.join('\n'));
        w(pc.green(`\n✓ 已创建 ${mdPath}\n`));
        created++;
      } else {
        w(pc.gray(`DEEPSEEK.md 已存在，跳过\n`));
      }

      // 2. 生成 commands 目录骨架
      const dir = path.join(ctx.cwd, '.deepseek-code', 'commands');
      fs.mkdirSync(dir, { recursive: true });
      const sample = path.join(dir, 'hello.md');
      if (!fs.existsSync(sample)) {
        fs.writeFileSync(sample, `---\ndescription: Sample command\nargument-hint: <name>\n---\nSay hello to $1. Extra: $ARGUMENTS\n`);
        w(pc.green(`✓ 已创建 ${dir}\n`));
        w(pc.gray('  示例文件：hello.md → 输入 /hello world 触发\n'));
        created++;
      }

      if (created === 0) w(pc.gray('所有文件已存在，无需初始化\n'));
      w('\n');
      return;
    }
    case 'resume': {
      if (!ctx.sessionStore) { w('会话存储不可用\n'); return; }
      const id = args.trim();
      if (!id) { w(pc.gray('用法: /resume <id>\n')); return; }
      const s = ctx.sessionStore.get(id);
      if (!s) { w(pc.red(`会话 ${id} 不存在\n`)); return; }
      ctx.session.id = s.id;
      ctx.session.messages = s.messages;
      ctx.session.readFiles = s.readFiles;
      ctx.session.usage = s.usage;
      ctx.session.startedAt = s.startedAt;
      ctx.session.lastActiveAt = s.lastActiveAt;
      ctx.flashStatus(`✓ 已切换到会话 ${s.id.slice(0, 8)}`);
      return;
    }
    case 'cancel':
      w(pc.gray('已取消\n'));
      return;
    case 'quit':
    case 'exit':
      return 'quit';
  }
}
