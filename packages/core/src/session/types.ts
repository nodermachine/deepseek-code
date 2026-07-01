import type { Message, Usage } from '../types.js';

/** 会话数据结构 */
export interface Session {
  id: string;
  messages: Message[];
  readFiles: Set<string>;
  usage: Usage;
  startedAt: Date;
  /** 最后活跃时间，用于会话列表排序 */
  lastActiveAt: Date;
}

/** 会话列表元数据（不含完整消息） */
export interface SessionMeta {
  id: string;
  startedAt: string;
  lastActiveAt: string;
  messageCount: number;
  /** 第一条用户消息的前 80 字符，用于预览 */
  firstUserMessage: string;
}

/** 会话存储后端接口 */
export interface SessionStore {
  /** 创建新会话 */
  create(): Session;
  /** 根据 id 获取会话 */
  get(id: string): Session | undefined;
  /** 列出所有会话元数据 */
  list(): SessionMeta[];
  /** 保存/更新会话到存储 */
  save(session: Session): void;
  /** 删除指定会话 */
  delete(id: string): void;
}
