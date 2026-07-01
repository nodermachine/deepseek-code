/**
 * @file 统一错误类型
 * 所有可预期的错误均通过 DeepseekCodeError 抛出，便于上层区分处理
 */

/** DeepseekCodeError 构造参数 */
export interface DeepseekCodeErrorInit {
  /** 机器可读的错误码，如 'PROVIDER_429'、'CONFIG_MISSING_KEY' */
  code: string;
  /** 内部日志用的英文消息 */
  message: string;
  /** 面向用户的中文提示 */
  userMessage: string;
  /** 是否可恢复（可恢复的错误会被回喂给模型重试） */
  recoverable?: boolean;
  /** 底层原始错误 */
  cause?: unknown;
}

/**
 * 项目统一错误类
 * - code: 用于程序化判断
 * - userMessage: 用于终端显示
 * - recoverable: 用于 agent loop 判断是否继续
 */
export class DeepseekCodeError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly recoverable: boolean;
  override readonly cause?: unknown;

  constructor(init: DeepseekCodeErrorInit) {
    super(init.message);
    this.name = 'DeepseekCodeError';
    this.code = init.code;
    this.userMessage = init.userMessage;
    this.recoverable = init.recoverable ?? false;
    this.cause = init.cause;
  }
}
