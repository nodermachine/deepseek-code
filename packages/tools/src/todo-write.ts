/**
 * @file TodoWrite 工具
 * 维护 session 级别的任务清单，模型可随时创建/更新/标记完成任务
 * 任务清单存储在 ToolContext.session 中（通过 readFiles 的扩展机制）
 */
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const TodoItemSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'done']),
});

const InputSchema = z.object({
  todos: z.array(TodoItemSchema).min(1),
  merge: z.boolean().optional(),
});

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface TodoWriteOutput {
  count: number;
  todos: TodoItem[];
}

// 全局任务清单存储（session 级别，进程内共享）
let globalTodos: TodoItem[] = [];

/** 获取当前任务清单（供渲染层使用） */
export function getTodos(): TodoItem[] {
  return [...globalTodos];
}

/** 重置任务清单（用于测试） */
export function resetTodos(): void {
  globalTodos = [];
}

export const todoWriteTool: Tool<z.infer<typeof InputSchema>, TodoWriteOutput> = {
  name: 'TodoWrite',
  description: '创建或更新任务清单。merge=true 时按 id 合并更新，merge=false 时替换全部。用于跟踪复杂任务的进度。',
  inputSchema: InputSchema,
  needsPermission: () => null,
  async execute(input) {
    if (input.merge) {
      // 按 id 合并更新
      for (const item of input.todos) {
        const idx = globalTodos.findIndex(t => t.id === item.id);
        if (idx !== -1) {
          globalTodos[idx] = item;
        } else {
          globalTodos.push(item);
        }
      }
    } else {
      // 替换全部
      globalTodos = [...input.todos];
    }
    // 格式化展示
    const display = globalTodos.map(t => {
      const icon = t.status === 'done' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
      return `${icon} ${t.content}`;
    }).join('\n');
    return {
      ok: true,
      output: { count: globalTodos.length, todos: [...globalTodos] },
      display: display || '(空清单)',
    };
  },
};
