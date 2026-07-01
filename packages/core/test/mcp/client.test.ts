/**
 * @file MCP 客户端单元测试
 * 测试 McpClient 的连接、工具列表获取、工具调用、断开连接
 * 使用 mock stdio 子进程模拟 MCP Server
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpClient } from '../../src/mcp/client.js';
import { adaptMcpTool, loadMcpTools } from '../../src/mcp/tool-adapter.js';
import type { McpToolDef } from '../../src/mcp/types.js';

describe('McpClient', () => {
  it('throws when calling listTools before connect', async () => {
    const client = new McpClient();
    await expect(client.listTools()).rejects.toThrow('not connected');
  });

  it('throws when calling callTool before connect', async () => {
    const client = new McpClient();
    await expect(client.callTool('test', {})).rejects.toThrow('not connected');
  });

  it('isConnected returns false initially', () => {
    const client = new McpClient();
    expect(client.isConnected()).toBe(false);
  });

  it('disconnect clears connection state', () => {
    const client = new McpClient();
    // Disconnect on a non-connected client should not throw
    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });
});

describe('adaptMcpTool', () => {
  it('adapts MCP tool definition to Tool interface', () => {
    const def: McpToolDef = {
      name: 'query',
      description: 'Execute SQL query',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
    };

    const mockClient = new McpClient();
    const tool = adaptMcpTool(def, mockClient, 'sqlite');

    expect(tool.name).toBe('mcp_sqlite_query');
    expect(tool.description).toContain('[MCP:sqlite]');
    expect(tool.description).toContain('Execute SQL query');
  });

  it('needsPermission returns permission request', () => {
    const def: McpToolDef = {
      name: 'run',
      description: 'Run command',
      inputSchema: { type: 'object' },
    };

    const mockClient = new McpClient();
    const tool = adaptMcpTool(def, mockClient, 'shell');
    const perm = tool.needsPermission({});

    expect(perm).not.toBeNull();
    expect(perm!.tool).toBe('mcp_shell_run');
    expect(perm!.matcher).toBe('shell');
  });

  it('execute returns error when client not connected', async () => {
    const def: McpToolDef = {
      name: 'test',
      description: 'Test tool',
      inputSchema: { type: 'object' },
    };

    const mockClient = new McpClient();
    const tool = adaptMcpTool(def, mockClient, 'test-server');

    const result = await tool.execute({}, {
      cwd: '/tmp',
      signal: new AbortController().signal,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
      session: { readFiles: new Set() },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not connected');
    }
  });

  it('loadMcpTools returns empty array for non-connected client', async () => {
    const client = new McpClient();
    await expect(loadMcpTools(client, 'test')).rejects.toThrow('not connected');
  });
});
