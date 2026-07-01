import { useEffect, useRef, useState } from 'react';
import type { AgentEvent, ToolResultEnvelope } from '@deepseek-code/core';

export interface UIMessage {
  type: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResultEnvelope;
}

export interface UseAgentStreamState {
  messages: UIMessage[];
  streaming: string;
  thinking: string;
  isRunning: boolean;
  exitCode: number;
}

export function useAgentStream(events: AsyncIterable<AgentEvent> | null): UseAgentStreamState {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [thinking, setThinking] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [exitCode, setExitCode] = useState(0);
  const iterRef = useRef<AsyncIterable<AgentEvent> | null>(null);

  useEffect(() => {
    if (!events || iterRef.current === events) return;
    iterRef.current = events;
    setIsRunning(true);
    setStreaming('');
    setThinking('');

    let cancelled = false;
    (async () => {
      let ec = 0;
      for await (const ev of events) {
        if (cancelled) break;
        switch (ev.type) {
          case 'text_delta':
            setStreaming((prev) => prev + ev.text);
            break;
          case 'thinking_delta':
            setThinking((prev) => prev + ev.text);
            break;
          case 'tool_call_start':
            setStreaming((prev) => {
              if (prev) setMessages((m) => [...m, { type: 'assistant', content: prev }]);
              return '';
            });
            setThinking('');
            setMessages((m) => [
              ...m,
              { type: 'tool', content: '', toolName: ev.name, toolInput: ev.input },
            ]);
            break;
          case 'tool_call_result':
            setMessages((m) => {
              const u = [...m];
              for (let i = u.length - 1; i >= 0; i--) {
                if (u[i].type === 'tool' && !u[i].toolResult) {
                  u[i] = { ...u[i], toolResult: ev.result };
                  break;
                }
              }
              return u;
            });
            break;
          case 'error':
            setMessages((m) => [
              ...m,
              { type: 'error', content: `${ev.error.code}: ${ev.error.userMessage}` },
            ]);
            break;
          case 'done':
            setStreaming((prev) => {
              if (prev) setMessages((m) => [...m, { type: 'assistant', content: prev }]);
              return '';
            });
            setThinking('');
            setIsRunning(false);
            if (ev.reason === 'fatal' || ev.reason === 'max_steps') ec = 1;
            if (ev.reason === 'abort') ec = 130;
            break;
        }
      }
      setExitCode(ec);
    })();

    return () => { cancelled = true; };
  }, [events]);

  return { messages, streaming, thinking, isRunning, exitCode };
}

export function pushUserMessage(setMessages: (fn: (m: UIMessage[]) => UIMessage[]) => void, text: string): void {
  setMessages((m) => [...m, { type: 'user', content: text }]);
}
