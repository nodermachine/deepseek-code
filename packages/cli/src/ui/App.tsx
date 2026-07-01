/**
 * @file Persistent Ink shell
 *
 * 单一 Ink 实例贯穿整个 REPL：AgentStream + StatusBar + InputBox。
 * REPL 通过 mountAppShell 拿到 handle 后调用 updateEvents / updateStatus 推进状态；
 * 用户输入通过 onSubmit / onAbort / onExit / onMemoryAppend 回调返回。
 *
 * renderWithInk 保留为向后兼容的一次性事件流渲染（非交互模式使用）。
 */
import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { render, Box, Text } from 'ink';
import type { AgentEvent, CommandRegistry, FileIndex } from '@deepseek-code/core';
import { AgentStream } from './AgentStream.js';
import { useAgentStream, type UIMessage } from './hooks/useAgentStream.js';
import { InputBox } from './InputBox.js';

interface StatusFields {
  model: string;
  sessionId: string;
  msgCount: number;
  flash?: string;
}

interface RefBundle {
  events: { current: AsyncIterable<AgentEvent> | null };
  status: { current: StatusFields };
  history: { current: string[] };
  echoUser: { current: string | null };
}

interface AppShellProps {
  registry: CommandRegistry;
  fileIndex: FileIndex;
  refs: RefBundle;
  bindNotify(fn: () => void): void;
  onSubmit(input: string, attachments: string[]): void;
  onAbort(): void;
  onExit(): void;
  onMemoryAppend(scope: 'project' | 'user', text: string): void;
}

function AppShell(props: AppShellProps) {
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  const [events, setEvents] = useState<AsyncIterable<AgentEvent> | null>(null);

  useEffect(() => {
    props.bindNotify(() => {
      const cur = props.refs.events.current;
      setEvents(cur);
      forceRender();
    });
  }, []);

  const streamState = useAgentStream(events);

  const echoed = props.refs.echoUser.current;
  const displayedMessages: UIMessage[] = echoed
    ? [{ type: 'user', content: echoed }, ...streamState.messages]
    : streamState.messages;

  const status = props.refs.status.current;

  const handleSubmit = useCallback(
    (input: string, attachments: string[]) => {
      const h = props.refs.history.current;
      if (h[h.length - 1] !== input) h.push(input);
      props.onSubmit(input, attachments);
    },
    [props],
  );

  return (
    <Box flexDirection="column">
      <AgentStream state={{ ...streamState, messages: displayedMessages }} />
      <Box marginTop={0}>
        <Text color="gray">
          model: {status.model}  ·  session: {status.sessionId.slice(0, 8)}  ·  msgs: {status.msgCount}
          {status.flash ? '  ·  ' + status.flash : ''}
        </Text>
      </Box>
      <InputBox
        registry={props.registry}
        fileIndex={props.fileIndex}
        history={props.refs.history.current}
        isRunning={streamState.isRunning}
        onSubmit={handleSubmit}
        onAbort={props.onAbort}
        onExit={props.onExit}
        onMemoryAppend={props.onMemoryAppend}
      />
    </Box>
  );
}

export interface MountedApp {
  updateEvents(e: AsyncIterable<AgentEvent> | null): void;
  updateStatus(s: Partial<StatusFields>): void;
  echoUser(text: string | null): void;
  unmount(): void;
  waitUntilExit(): Promise<void>;
}

export interface MountDeps {
  registry: CommandRegistry;
  fileIndex: FileIndex;
  initialStatus: StatusFields;
  history?: string[];
  onSubmit(input: string, attachments: string[]): void;
  onAbort(): void;
  onExit(): void;
  onMemoryAppend(scope: 'project' | 'user', text: string): void;
}

export function mountAppShell(deps: MountDeps): MountedApp {
  const refs: RefBundle = {
    events: { current: null },
    status: { current: { ...deps.initialStatus } },
    history: { current: deps.history ?? [] },
    echoUser: { current: null },
  };
  let notify: () => void = () => {};

  const instance = render(
    <AppShell
      registry={deps.registry}
      fileIndex={deps.fileIndex}
      refs={refs}
      bindNotify={(fn) => { notify = fn; }}
      onSubmit={deps.onSubmit}
      onAbort={deps.onAbort}
      onExit={deps.onExit}
      onMemoryAppend={deps.onMemoryAppend}
    />,
    { exitOnCtrlC: false },
  );

  return {
    updateEvents(e) { refs.events.current = e; notify(); },
    updateStatus(s) { refs.status.current = { ...refs.status.current, ...s }; notify(); },
    echoUser(text) { refs.echoUser.current = text; notify(); },
    unmount() { instance.unmount(); },
    waitUntilExit() { return instance.waitUntilExit(); },
  };
}

/**
 * 向后兼容：非交互模式的一次性事件流渲染。
 * 单次任务模式（deepseek "prompt"）走这条路径。
 */
export async function renderWithInk(
  events: AsyncIterable<AgentEvent>,
): Promise<{ exitCode: number }> {
  const { PassThrough } = await import('node:stream');
  const fakeStdin = new PassThrough() as any;
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => fakeStdin;
  fakeStdin.ref = () => fakeStdin;
  fakeStdin.unref = () => fakeStdin;

  let exitCode = 0;

  function OneShot({ events }: { events: AsyncIterable<AgentEvent> }) {
    const s = useAgentStream(events);
    useEffect(() => {
      if (!s.isRunning && s.exitCode !== undefined) {
        exitCode = s.exitCode;
      }
    }, [s.isRunning, s.exitCode]);
    return <AgentStream state={s} />;
  }

  return new Promise((resolve) => {
    const instance = render(<OneShot events={events} />, {
      stdin: fakeStdin,
      exitOnCtrlC: false,
    });
    (async () => {
      for await (const ev of events) {
        if (ev.type === 'done') {
          if (ev.reason === 'fatal' || ev.reason === 'max_steps') exitCode = 1;
          if (ev.reason === 'abort') exitCode = 130;
          break;
        }
      }
      setTimeout(() => {
        instance.unmount();
        fakeStdin.end();
        resolve({ exitCode });
      }, 50);
    })();
  });
}
