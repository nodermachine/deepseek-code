import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool } from './types.js';
import type { ToolSchema } from '../types.js';

/**
 * 移除 JSON Schema 中 DeepSeek API 不认识的字段
 * 如 $schema、additionalProperties 等，并将 draft-04 的
 * exclusiveMinimum:true + minimum:N 转换为 draft-07 的 exclusiveMinimum:N
 */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...schema };
  delete cleaned['$schema'];
  delete cleaned['$ref'];
  // 修复 draft-04 exclusiveMinimum/exclusiveMaximum 布尔值问题
  if (cleaned.exclusiveMinimum === true && typeof cleaned.minimum === 'number') {
    cleaned.exclusiveMinimum = cleaned.minimum;
    delete cleaned.minimum;
  }
  if (cleaned.exclusiveMaximum === true && typeof cleaned.maximum === 'number') {
    cleaned.exclusiveMaximum = cleaned.maximum;
    delete cleaned.maximum;
  }
  // 递归清理 properties
  if (cleaned.properties && typeof cleaned.properties === 'object') {
    const props = cleaned.properties as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(props)) {
      props[key] = cleanSchema(props[key]);
    }
  }
  // 递归清理 items
  if (cleaned.items && typeof cleaned.items === 'object') {
    cleaned.items = cleanSchema(cleaned.items as Record<string, unknown>);
  }
  return cleaned;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool name: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  toSchemas(): ToolSchema[] {
    return this.list().map(t => {
      const rawSchema = zodToJsonSchema(t.inputSchema, { target: 'openApi3' }) as Record<string, unknown>;
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: cleanSchema(rawSchema),
        },
      };
    });
  }
}
