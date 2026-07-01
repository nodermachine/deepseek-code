/**
 * @file REPL 主循环（v3：持久 Ink 实例）
 *
 * 老版本用 node:readline + 手写 ANSI 建议菜单 + 每 turn 起一个 Ink 实例。
 * 新版本：
 * - Ink 只 mount 一次；InputBox 直接接管 stdin，删除 readline
 * - 命令路由（内置 / project / user / skill 四类）
 * - @file 附件、#memory 追加、持久 status bar、fuzzy 菜单
 * - 兼容 /skills/<name> 旧语法
 */
import pc from 'picocolors';
import type {
  Session, SessionStore, SkillRegistry, Config, Provider, AgentEvent,
} from '@deepseek-code/core';
import {
  CommandRegistry, FileIndex, appendMemory, buildSystemPrompt,
} from '@deepseek-code/core';
import { mountAppShell, type MountedApp } from './ui/App.js';
import { routeInput } from './router/index.js';
import { registerBuiltins, runBuiltin } from './router/builtins.js';

export interface RunTurnOpts {
  modelOverride?: string;
  allowedTools?: string[];
  attachments?: string[];
  usePlan?: boolean;
  events?: (e: AsyncIterable<AgentEvent>) => void;
}

export interface ReplDeps {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  runTurn: (
    input: string,
    session: Session,
    signal: AbortSignal,
    opts: RunTurnOpts,
  ) => Promise<number>;
  session: Session;
  getModel: () => string;
  setModel: (m: string) => void;
  sessionStore?: SessionStore;
  skillRegistry?: SkillRegistry;
  config?: Config;
  configSources?: Record<string, string>;
  provider?: Provider;
  cwd: string;
}

export async function startRepl(deps: ReplDeps): Promise<number> {
  const registry = new CommandRegistry();
  registerBuiltins(registry);
  registry.loadFromDisk({ cwd: deps.cwd });
  if (deps.skillRegistry) registry.ingestSkillCommands(deps.skillRegistry.list());

  const fileIndex = new FileIndex({ cwd: deps.cwd });
  fileIndex.load();

  let activeAbort: AbortController | null = null;
  let lastExit = 0;
  let app!: MountedApp;
  let exiting = false;
  let exitResolve: () => void = () => {};
  const exitPromise = new Promise<void>((r) => { exitResolve = r; });

  const flashStatus = (msg: string) => {
    app.updateStatus({ flash: msg });
    setTimeout(() => {
      const cur = app;
      if (cur) cur.updateStatus({ flash: undefined });
    }, 2000);
  };

  const doExit = () => {
    if (exiting) return;
    exiting = true;
    if (activeAbort) activeAbort.abort();
    app.unmount();
    exitResolve();
  };

  const onSubmit = async (raw: string, attachments: string[]) => {
    const action = routeInput(raw, registry);

    if (action.kind === 'builtin') {
      const result = await runBuiltin(action.name, action.args, {
        session: deps.session,
        stdout: deps.stdout,
        getModel: deps.getModel,
        setModel: (m) => { deps.setModel(m); app.updateStatus({ model: m }); },
        sessionStore: deps.sessionStore,
        skillRegistry: deps.skillRegistry,
        config: deps.config,
        configSources: deps.configSources,
        provider: deps.provider,
        cwd: deps.cwd,
        registry,
        flashStatus,
      });
      if (result === 'quit') { doExit(); return; }
      app.updateStatus({
        msgCount: deps.session.messages.length,
        sessionId: deps.session.id,
      });
      return;
    }

    if (action.kind === 'unknown') {
      // legacy /skills/<name>
      const skillMatch = raw.match(/^\/skills\/([^\s]+)(?:\s+(.*))?$/);
      if (skillMatch && deps.skillRegistry) {
        const [, skillName, prompt] = skillMatch;
        const skill = deps.skillRegistry.getByCommand(skillName)
          ?? deps.skillRegistry.list().find((s) => s.name === skillName);
        if (skill) {
          const enriched = `[Skill: ${skill.name}]\n${skill.content}\n\n---\n${prompt || '请按以上技能指引执行'}`;
          await runAgentTurn(enriched, { attachments });
          return;
        }
      }
      flashStatus(pc.red(`未知命令: /${action.name}`));
      return;
    }

    // passthrough or agent command → both dispatch as agent turn
    const prompt = action.kind === 'agent' ? action.prompt : action.kind === 'passthrough' ? action.text : '';
    const turnOpts: RunTurnOpts = { attachments };
    if (action.kind === 'agent') {
      turnOpts.allowedTools = action.allowedTools;
      turnOpts.modelOverride = action.modelOverride;
    }
    // /plan 通过 builtin 分支不再消费；这里检测原始输入即可
    if (raw.startsWith('/plan')) {
      turnOpts.usePlan = true;
      await runAgentTurn(raw.slice(5).trimStart(), turnOpts);
    } else {
      await runAgentTurn(prompt, turnOpts);
    }
  };

  const runAgentTurn = async (prompt: string, opts: RunTurnOpts) => {
    if (!prompt.trim()) return;
    app.echoUser(prompt);
    activeAbort = new AbortController();
    lastExit = await deps.runTurn(prompt, deps.session, activeAbort.signal, {
      ...opts,
      events: (e) => app.updateEvents(e),
    });
    activeAbort = null;
    app.echoUser(null);
    app.updateEvents(null);
    app.updateStatus({
      msgCount: deps.session.messages.length,
      sessionId: deps.session.id,
      model: deps.getModel(),
    });
  };

  const onMemoryAppend = (scope: 'project' | 'user', text: string) => {
    try {
      const r = appendMemory({ scope, text, cwd: deps.cwd });
      // rebuild system prompt for next turn
      const alwaysOn = deps.skillRegistry?.getAlwaysOn() ?? [];
      const newSys = buildSystemPrompt({ cwd: deps.cwd, skills: alwaysOn, model: deps.getModel() });
      const sysIdx = deps.session.messages.findIndex((m) => m.role === 'system');
      if (sysIdx >= 0) deps.session.messages[sysIdx].content = newSys;
      flashStatus(`✓ 已${r.created ? '创建' : '追加到'}${scope === 'project' ? '项目' : '用户'}级 memory`);
    } catch (e) {
      flashStatus(pc.red(`memory 追加失败: ${(e as Error).message}`));
    }
  };

  app = mountAppShell({
    registry,
    fileIndex,
    initialStatus: {
      model: deps.getModel(),
      sessionId: deps.session.id,
      msgCount: deps.session.messages.length,
    },
    onSubmit,
    onAbort: () => { if (activeAbort) activeAbort.abort(); },
    onExit: doExit,
    onMemoryAppend,
  });

  await Promise.race([exitPromise, app.waitUntilExit()]);
  return lastExit;
}
