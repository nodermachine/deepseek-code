import React from 'react';
import { Box, Text, Static } from 'ink';
import Spinner from 'ink-spinner';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { UseAgentStreamState, UIMessage } from './hooks/useAgentStream.js';
import type { ToolResultEnvelope } from '@deepseek-code/core';

const marked = new Marked(markedTerminal() as any);

function renderMarkdown(md: string): string {
  try { return (marked.parse(md) as string).trimEnd(); }
  catch { return md; }
}

function ToolPanel({ name, input, result }: { name: string; input: unknown; result?: ToolResultEnvelope }) {
  const shortInput =
    typeof input === 'object' && input
      ? (input as any).file_path
        ?? (input as any).command?.slice(0, 60)
        ?? (input as any).pattern
        ?? JSON.stringify(input).slice(0, 60)
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

function MessageView({ msg }: { msg: UIMessage & { __i: number } }) {
  switch (msg.type) {
    case 'user':
      return <Text color="green">┃ You: {msg.content}</Text>;
    case 'assistant':
      return <Text>{renderMarkdown(msg.content)}</Text>;
    case 'tool':
      return <ToolPanel name={msg.toolName!} input={msg.toolInput} result={msg.toolResult} />;
    case 'error':
      return <Text color="red">! {msg.content}</Text>;
    default:
      return null;
  }
}

export function AgentStream({ state }: { state: UseAgentStreamState }) {
  const { messages, streaming, thinking, isRunning } = state;
  const items = messages.map((m, i) => ({ ...m, __i: i }));
  return (
    <Box flexDirection="column">
      <Static items={items}>{(m) => <MessageView key={m.__i} msg={m} />}</Static>
      {thinking && (
        <Box>
          <Text color="gray"><Spinner type="dots" /> {thinking.slice(-120)}</Text>
        </Box>
      )}
      {streaming && <Text>{renderMarkdown(streaming)}</Text>}
      {isRunning && !streaming && !thinking && (
        <Box><Text color="gray"><Spinner type="dots" /> 等待响应...</Text></Box>
      )}
    </Box>
  );
}
