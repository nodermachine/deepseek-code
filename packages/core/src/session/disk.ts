/**
 * @file 磁盘会话存储
 * 会话持久化到 ~/.deepseek-code/sessions/<id>.json
 * 每次 save() 整体序列化，支持 list/get/delete
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Session, SessionStore, SessionMeta } from './types.js';
import type { Message, Usage } from '../types.js';

/** 序列化后的 Session JSON 结构 */
interface SessionJson {
  id: string;
  messages: Message[];
  readFiles: string[];  // Set<string> 序列化为数组
  usage: Usage;
  startedAt: string;    // ISO 8601
  lastActiveAt: string;
}

export interface DiskSessionStoreOpts {
  /** 自定义存储目录（默认 ~/.deepseek-code/sessions） */
  dir?: string;
  /** 自定义 home 目录（测试用） */
  homeDir?: string;
  /** save debounce 延迟毫秒数（默认 500ms，设 0 禁用） */
  debounceMs?: number;
}

export class DiskSessionStore implements SessionStore {
  private readonly dir: string;
  /** debounce 计时器，避免连续工具调用时频繁写盘 */
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs: number;

  constructor(opts: DiskSessionStoreOpts = {}) {
    this.dir = opts.dir ?? join(opts.homeDir ?? homedir(), '.deepseek-code', 'sessions');
    this.debounceMs = opts.debounceMs ?? 500;
    mkdirSync(this.dir, { recursive: true });
  }

  /** 创建新空会话 */
  create(): Session {
    const id = randomBytes(8).toString('hex');
    const now = new Date();
    const s: Session = {
      id,
      messages: [],
      readFiles: new Set<string>(),
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      startedAt: now,
      lastActiveAt: now,
    };
    this.save(s);
    return s;
  }

  /** 从磁盘加载指定会话 */
  get(id: string): Session | undefined {
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const raw: SessionJson = JSON.parse(readFileSync(path, 'utf8'));
      return this.deserialize(raw);
    } catch {
      return undefined;
    }
  }

  /** 列出所有会话元数据（按最后活跃时间倒序） */
  list(): SessionMeta[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const metas: SessionMeta[] = [];
    for (const file of files) {
      try {
        const raw: SessionJson = JSON.parse(readFileSync(join(this.dir, file), 'utf8'));
        const firstUser = raw.messages.find(m => m.role === 'user');
        metas.push({
          id: raw.id,
          startedAt: raw.startedAt,
          lastActiveAt: raw.lastActiveAt,
          messageCount: raw.messages.length,
          firstUserMessage: firstUser?.content?.slice(0, 80) ?? '',
        });
      } catch { /* 跳过损坏的文件 */ }
    }
    // 按最后活跃时间倒序
    return metas.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  /** 保存会话到磁盘（带 debounce，避免连续工具调用频繁写盘） */
  save(session: Session): void {
    session.lastActiveAt = new Date();
    // debounce：取消上一次未执行的写入，延迟执行
    if (this.debounceMs > 0) {
      const existing = this.saveTimers.get(session.id);
      if (existing) clearTimeout(existing);
      this.saveTimers.set(session.id, setTimeout(() => {
        this.saveTimers.delete(session.id);
        this.writeSession(session);
      }, this.debounceMs));
    } else {
      this.writeSession(session);
    }
  }

  /** 立即强制写入（进程退出前调用） */
  flush(session: Session): void {
    const timer = this.saveTimers.get(session.id);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(session.id);
    }
    this.writeSession(session);
  }

  /** 实际写磁盘 */
  private writeSession(session: Session): void {
    const json: SessionJson = {
      id: session.id,
      messages: session.messages,
      readFiles: [...session.readFiles],
      usage: session.usage,
      startedAt: session.startedAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
    };
    writeFileSync(join(this.dir, `${session.id}.json`), JSON.stringify(json, null, 2));
  }

  /** 删除指定会话文件 */
  delete(id: string): void {
    const path = join(this.dir, `${id}.json`);
    if (existsSync(path)) rmSync(path);
  }

  /** 反序列化 JSON → Session 对象 */
  private deserialize(raw: SessionJson): Session {
    return {
      id: raw.id,
      messages: raw.messages,
      readFiles: new Set(raw.readFiles),
      usage: raw.usage,
      startedAt: new Date(raw.startedAt),
      lastActiveAt: new Date(raw.lastActiveAt),
    };
  }
}
