import { describe, it, expect } from 'vitest';
import { isSensitivePath } from '../../src/hooks/defaults.js';

describe('isSensitivePath', () => {
  it('flags core loader/registry/permission/agent files', () => {
    expect(isSensitivePath('packages/core/src/skills/loader.ts')).toBe(true);
    expect(isSensitivePath('packages/core/src/commands/registry.ts')).toBe(true);
    expect(isSensitivePath('packages/core/src/permission/engine.ts')).toBe(true);
    expect(isSensitivePath('packages/core/src/agent/loop.ts')).toBe(true);
    expect(isSensitivePath('packages/core/src/memory/loader.ts')).toBe(true);
  });

  it('flags CLI entry points', () => {
    expect(isSensitivePath('packages/cli/src/main.ts')).toBe(true);
    expect(isSensitivePath('packages/cli/src/repl.ts')).toBe(true);
    expect(isSensitivePath('packages/cli/src/router/index.ts')).toBe(true);
  });

  it('flags tool implementations', () => {
    expect(isSensitivePath('packages/tools/src/edit.ts')).toBe(true);
    expect(isSensitivePath('packages/tools/src/bash.ts')).toBe(true);
  });

  it('does NOT flag ordinary project files', () => {
    expect(isSensitivePath('README.md')).toBe(false);
    expect(isSensitivePath('packages/cli/src/ui/AgentStream.tsx')).toBe(false);
    expect(isSensitivePath('docs/TODO.md')).toBe(false);
    expect(isSensitivePath('src/components/Button.tsx')).toBe(false);
  });

  it('handles Windows-style backslashes', () => {
    expect(isSensitivePath('packages\\core\\src\\skills\\loader.ts')).toBe(true);
  });

  it('flags DEEPSEEK-CODE config files', () => {
    expect(isSensitivePath('.deepseek-code/permissions.json')).toBe(true);
    expect(isSensitivePath('.deepseek-code/hooks/danger.js')).toBe(true);
  });
});
