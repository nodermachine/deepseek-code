import { describe, it, expect } from 'vitest';
import { DeepseekCodeError } from '../src/errors.js';

describe('DeepseekCodeError', () => {
  it('carries code, recoverable, userMessage, cause', () => {
    const cause = new Error('network');
    const e = new DeepseekCodeError({
      code: 'PROVIDER_429',
      message: 'rate limited',
      userMessage: '请求过于频繁，请稍后再试',
      recoverable: true,
      cause,
    });
    expect(e.code).toBe('PROVIDER_429');
    expect(e.userMessage).toBe('请求过于频繁，请稍后再试');
    expect(e.recoverable).toBe(true);
    expect(e.cause).toBe(cause);
    expect(e.message).toBe('rate limited');
    expect(e).toBeInstanceOf(Error);
  });

  it('defaults recoverable to false', () => {
    const e = new DeepseekCodeError({ code: 'X', message: 'm', userMessage: 'u' });
    expect(e.recoverable).toBe(false);
  });
});
