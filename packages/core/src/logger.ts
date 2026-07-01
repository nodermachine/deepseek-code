import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  event(type: string, payload: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export class NullLogger implements Logger {
  debug(_msg: string, _fields?: Record<string, unknown>): void {}
  info(_msg: string, _fields?: Record<string, unknown>): void {}
  warn(_msg: string, _fields?: Record<string, unknown>): void {}
  error(_msg: string, _fields?: Record<string, unknown>): void {}
  event(_type: string, _payload: Record<string, unknown>): void {}
  async flush(): Promise<void> {}
}

export class ConsoleLogger implements Logger {
  constructor(private readonly minLevel: LogLevel = 'info') {}

  private rank(l: LogLevel): number {
    return { debug: 0, info: 1, warn: 2, error: 3 }[l];
  }

  private log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (this.rank(level) < this.rank(this.minLevel)) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
    process.stderr.write(line + '\n');
  }

  debug(msg: string, fields?: Record<string, unknown>): void { this.log('debug', msg, fields); }
  info(msg: string, fields?: Record<string, unknown>): void { this.log('info', msg, fields); }
  warn(msg: string, fields?: Record<string, unknown>): void { this.log('warn', msg, fields); }
  error(msg: string, fields?: Record<string, unknown>): void { this.log('error', msg, fields); }

  event(type: string, payload: Record<string, unknown>): void {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), type, ...payload }) + '\n');
  }

  async flush(): Promise<void> {}
}

export class JsonlLogger implements Logger {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  private write(obj: Record<string, unknown>): void {
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
  }

  debug(msg: string, fields?: Record<string, unknown>): void { this.write({ level: 'debug', msg, ...fields }); }
  info(msg: string, fields?: Record<string, unknown>): void { this.write({ level: 'info', msg, ...fields }); }
  warn(msg: string, fields?: Record<string, unknown>): void { this.write({ level: 'warn', msg, ...fields }); }
  error(msg: string, fields?: Record<string, unknown>): void { this.write({ level: 'error', msg, ...fields }); }

  event(type: string, payload: Record<string, unknown>): void {
    this.write({ type, ...payload });
  }

  async flush(): Promise<void> {}
}
