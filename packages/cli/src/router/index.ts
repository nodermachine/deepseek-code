import type { CommandRegistry } from '@deepseek-code/core';
import { expandArguments } from '@deepseek-code/core';

export type RouterAction =
  | { kind: 'builtin'; name: string; args: string }
  | { kind: 'agent'; prompt: string; allowedTools?: string[]; modelOverride?: string }
  | { kind: 'unknown'; name: string }
  | { kind: 'passthrough'; text: string };

export function routeInput(input: string, registry: CommandRegistry): RouterAction {
  if (!input.startsWith('/')) {
    return { kind: 'passthrough', text: input };
  }
  const stripped = input.slice(1);
  const spaceIdx = stripped.indexOf(' ');
  const name = spaceIdx === -1 ? stripped : stripped.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : stripped.slice(spaceIdx + 1);

  const cmd = registry.resolve(name);
  if (!cmd) return { kind: 'unknown', name };

  if (cmd.source === 'builtin') {
    return { kind: 'builtin', name: cmd.name, args };
  }

  const prompt = expandArguments(cmd.body, args);
  return {
    kind: 'agent',
    prompt,
    allowedTools: cmd.allowedTools,
    modelOverride: cmd.model,
  };
}
