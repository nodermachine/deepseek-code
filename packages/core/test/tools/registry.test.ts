import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const echoTool: Tool<{ msg: string }, { echoed: string }> = {
  name: 'Echo',
  description: 'echoes input',
  inputSchema: z.object({ msg: z.string() }),
  needsPermission: () => null,
  async execute(input) { return { ok: true, output: { echoed: input.msg } }; },
};

describe('ToolRegistry', () => {
  it('registers and looks up tools', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    expect(r.get('Echo')).toBe(echoTool);
    expect(r.list().map(t => t.name)).toEqual(['Echo']);
  });

  it('rejects duplicate names', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    expect(() => r.register(echoTool)).toThrow(/duplicate/i);
  });

  it('toSchemas produces OpenAI tools format', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    const schemas = r.toSchemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].type).toBe('function');
    expect(schemas[0].function.name).toBe('Echo');
    expect(schemas[0].function.description).toBe('echoes input');
    expect(schemas[0].function.parameters).toMatchObject({ type: 'object' });
  });
});
