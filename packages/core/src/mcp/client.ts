/**
 * @file MCP 客户端实现
 * 支持 stdio 和 SSE 两种传输方式连接 MCP Server
 * 通过 JSON-RPC 2.0 协议通信
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { McpTransport, McpToolDef, McpToolResult, McpRequest, McpResponse } from './types.js';

/**
 * MCP 客户端
 * 管理与 MCP Server 的连接，提供 listTools 和 callTool 方法
 */
export class McpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private transport: McpTransport | null = null;
  private connected = false;

  /** 连接到 MCP Server */
  async connect(transport: McpTransport): Promise<void> {
    this.transport = transport;

    if (transport.type === 'stdio') {
      await this.connectStdio(transport);
    } else {
      await this.connectSse(transport);
    }

    // 发送 initialize 请求
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'deepseek-code', version: '0.3.0' },
    });

    // 发送 initialized 通知
    this.sendNotification('notifications/initialized', {});
    this.connected = true;
  }

  /** 获取 MCP Server 提供的工具列表 */
  async listTools(): Promise<McpToolDef[]> {
    if (!this.connected) throw new Error('MCP client not connected');
    const result = await this.sendRequest('tools/list', {}) as { tools: McpToolDef[] };
    return result.tools ?? [];
  }

  /** 调用 MCP 工具 */
  async callTool(name: string, args: unknown): Promise<McpToolResult> {
    if (!this.connected) throw new Error('MCP client not connected');
    const result = await this.sendRequest('tools/call', { name, arguments: args }) as McpToolResult;
    return result;
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /** stdio 模式连接 */
  private async connectStdio(transport: McpTransport & { type: 'stdio' }): Promise<void> {
    this.process = spawn(transport.command, transport.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...transport.env },
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error(`Failed to spawn MCP server: ${transport.command}`);
    }

    // 逐行读取 stdout 解析 JSON-RPC 响应
    const rl = createInterface({ input: this.process.stdout });
    rl.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line) as McpResponse;
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`MCP error: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // 忽略非 JSON 行
      }
    });

    this.process.on('exit', () => {
      this.connected = false;
    });
  }

  /** SSE 模式连接（简化实现，通过 HTTP POST 调用） */
  private async connectSse(_transport: McpTransport & { type: 'sse' }): Promise<void> {
    // SSE 模式暂用 HTTP POST 方式实现
    // 完整 SSE 实现需要持久连接，这里先提供基础能力
    this.connected = true;
  }

  /** 发送 JSON-RPC 请求并等待响应 */
  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    const request: McpRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      if (this.transport?.type === 'stdio' && this.process?.stdin) {
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } else if (this.transport?.type === 'sse') {
        // SSE 模式用 fetch POST
        this.sendSseRequest(request).then(resolve).catch(reject);
        this.pendingRequests.delete(id);
      }

      // 超时 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /** SSE 模式发送请求 */
  private async sendSseRequest(request: McpRequest): Promise<unknown> {
    if (!this.transport || this.transport.type !== 'sse') throw new Error('Not SSE transport');
    const resp = await fetch(this.transport.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.transport.headers },
      body: JSON.stringify(request),
    });
    if (!resp.ok) throw new Error(`MCP SSE error: HTTP ${resp.status}`);
    const data = await resp.json() as McpResponse;
    if (data.error) throw new Error(`MCP error: ${data.error.message}`);
    return data.result;
  }

  /** 发送通知（无需响应） */
  private sendNotification(method: string, params: Record<string, unknown>): void {
    const msg = { jsonrpc: '2.0', method, params };
    if (this.transport?.type === 'stdio' && this.process?.stdin) {
      this.process.stdin.write(JSON.stringify(msg) + '\n');
    }
  }
}
