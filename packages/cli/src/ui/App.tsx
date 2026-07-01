/**
 * @file Ink TUI 主应用
 * 使用 React Ink 构建终端 UI，支持 Markdown 渲染、工具调用面板、思考状态
 */
import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { PassThrough } from 'node:stream';
import Spinner from 'ink-spinner';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { AgentEvent, ToolResultEnvelope } from '@deepseek-code/core';

// 配置 marked-terminal 用于终端 Markdown 渲染
const marked = new Marked(markedTerminal() as any);

/** 将 Markdown 渲染为终端可显示的带颜色字符串 */
function renderMarkdown(md: string): string {
  try {
    return (marked.parse(md) as string).trimEnd();
  } catch {
    return md;
  }
}

// ===== 子组件 =====

/** 思考状态条 */
function ThinkingBar({ text }: { text: string }) {
  return (
    <Box>
      <Text color="gray">
        <Spinner type="dots" /> {text.slice(-120)}
      </Text>
    </Box>
  );
}

/** 工具调用面板 */
function ToolPanel({ name, input, result }: { name: string; input: unknown; result?: ToolResultEnvelope }) {
  const shortInput = typeof input === 'object' && input
    ? (input as any).file_path ?? (input as any).command?.slice(0, 60) ?? (input as any).pattern ?? JSON.stringify(input).slice(0, 60)
    : String(input).slice(0, 60);

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text color="cyan">▶ {name}({shortInput})</Text>
      {result && (
        result.ok
          ? <Text color="green">  ✓ OK</Text>
          : <Text color="red">  ✗ {result.error}</Text>
      )}
    </Box>
  );
}

// ===== 消息类型 =====
interface UIMessage {
  type: 'user' | 'assistant' | 'tool' | 'thinking' | 'error';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResultEnvelope;
}

// ===== 主 App 组件 =====
interface AppProps {
  /** AgentEvent 异步迭代器 */
  events: AsyncIterable<AgentEvent>;
  /** 完成回调 */
  onDone: (exitCode: number) => void;
}

function App({ events, onDone }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [thinking, setThinking] = useState('');
  const [isRunning, setIsRunning] = useState(true);

  useEffect(() => {
    let exitCode = 0;
    (async () => {
      for await (const ev of events) {
        switch (ev.type) {
          case 'text_delta':
            setStreaming(prev => prev + ev.text);
            break;
          case 'thinking_delta':
            setThinking(prev => prev + ev.text);
            break;
          case 'tool_call_start':
            // 先 flush 当前 streaming text
            setStreaming(prev => {
              if (prev) setMessages(msgs => [...msgs, { type: 'assistant', content: prev }]);
              return '';
            });
            setThinking('');
            setMessages(msgs => [...msgs, { type: 'tool', content: '', toolName: ev.name, toolInput: ev.input }]);
            break;
          case 'tool_call_result':
            setMessages(msgs => {
              const updated = [...msgs];
              // 找到最后一个未完成的 tool 消息
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].type === 'tool' && !updated[i].toolResult) {
                  updated[i] = { ...updated[i], toolResult: ev.result };
                  break;
                }
              }
              return updated;
            });
            break;
          case 'error':
            setMessages(msgs => [...msgs, { type: 'error', content: `${ev.error.code}: ${ev.error.userMessage}` }]);
            break;
          case 'done':
            // flush 剩余
            setStreaming(prev => {
              if (prev) setMessages(msgs => [...msgs, { type: 'assistant', content: prev }]);
              return '';
            });
            setThinking('');
            setIsRunning(false);
            if (ev.reason === 'fatal' || ev.reason === 'max_steps') exitCode = 1;
            if (ev.reason === 'abort') exitCode = 130;
            break;
        }
      }
      onDone(exitCode);
    })();
  }, [events, onDone]);

  // Ctrl+C 处理
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      onDone(130);
    }
  });

  return (
    <Box flexDirection="column">
      {/* 历史消息 */}
      {messages.map((msg, i) => {
        switch (msg.type) {
          case 'assistant':
            return <Text key={i}>{renderMarkdown(msg.content)}</Text>;
          case 'tool':
            return <ToolPanel key={i} name={msg.toolName!} input={msg.toolInput} result={msg.toolResult} />;
          case 'error':
            return <Text key={i} color="red">! {msg.content}</Text>;
          default:
            return null;
        }
      })}
      {/* 思考状态 */}
      {thinking && <ThinkingBar text={thinking} />}
      {/* 正在流式输出的文本 */}
      {streaming && <Text>{renderMarkdown(streaming)}</Text>}
      {/* 运行状态 */}
      {isRunning && !streaming && !thinking && (
        <Box><Text color="gray"><Spinner type="dots" /> 等待响应...</Text></Box>
      )}
    </Box>
  );
}

/**
 * 使用 Ink 渲染 AgentEvent 流
 * 返回 exitCode
 * 注意：使用带 setRawMode 的假 stdin，避免干扰 REPL 的 readline
 */
export async function renderWithInk(
  events: AsyncIterable<AgentEvent>,
): Promise<{ exitCode: number }> {
  // 创建带 setRawMode 的假 stdin，满足 Ink 内部检查
  const fakeStdin = new PassThrough() as any;
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => fakeStdin;
  fakeStdin.ref = () => fakeStdin;
  fakeStdin.unref = () => fakeStdin;

  return new Promise(resolve => {
    const instance = render(
      <App events={events} onDone={(exitCode) => {
        instance.unmount();
        fakeStdin.end();
        resolve({ exitCode });
      }} />,
      { stdin: fakeStdin, exitOnCtrlC: false },
    );
  });
}
