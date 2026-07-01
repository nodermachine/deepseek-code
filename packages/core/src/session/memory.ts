/**
 * @file 内存会话存储
 * 进程退出即丢失，用于测试或单次任务模式
 */
import { randomBytes } from 'node:crypto';
import type { Session, SessionStore, SessionMeta } from './types.js';

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

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
    this.sessions.set(id, s);
    return s;
  }

  get(id: string): Session | undefined { return this.sessions.get(id); }

  list(): SessionMeta[] {
    return [...this.sessions.values()].map(s => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      messageCount: s.messages.length,
      firstUserMessage: s.messages.find(m => m.role === 'user')?.content?.slice(0, 80) ?? '',
    }));
  }

  save(session: Session): void {
    session.lastActiveAt = new Date();
    this.sessions.set(session.id, session);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
