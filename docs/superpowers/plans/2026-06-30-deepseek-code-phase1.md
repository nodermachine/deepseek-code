# deepseek-code Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.1 of `deepseek-code` — a TypeScript CLI coding agent that lets DeepSeek complete a "read → edit → run → observe → re-edit" loop in a real repo, with safe permissioning and 80% test coverage.

**Architecture:** pnpm monorepo with three packages — `core` (provider abstraction, agent loop, permission engine, session, types), `tools` (Read / Edit / Write / Bash / Grep), `cli` (commander entry + readline REPL + streaming renderer). The core is decoupled from process IO via dependency injection so future TUI, SDK, and IDE-plugin surfaces can reuse it. The agent loop is a streaming state machine that emits structured events (`text_delta`, `thinking_delta`, `tool_call_start`, `tool_call_result`, `done`).

**Tech Stack:** TypeScript 5+, Node 20+, pnpm workspace, vitest + msw for testing, zod for schemas, `eventsource-parser` for SSE, `commander` for CLI, `picocolors` for color. No agent framework (no langchain / mastra) — agent loop is hand-written.

## Global Constraints

- Node version floor: **20.0.0**
- Package manager: **pnpm only** (lockfile committed)
- TypeScript target: **ES2022**, module: **NodeNext**, strict: true
- All public APIs in `core` exported from `packages/core/src/index.ts`
- `core` MUST NOT import `node:process`, `node:readline`, or anything from `cli` — IO is injected
- Tools live in `packages/tools` and only depend on `@deepseek-code/core` interfaces, never on each other
- Test coverage gate: **80%** statements/branches/lines in `packages/core` and `packages/tools` (vitest `--coverage`)
- Every commit message uses Conventional Commits (`feat:` / `fix:` / `test:` / `docs:` / `chore:`)
- All user-facing strings are Chinese (this is the primary user's language); log/code identifiers stay English
- API endpoint: `https://api.deepseek.com/v1/chat/completions`
- Default model: `deepseek-chat`; R1 (`deepseek-reasoner`) supported but downgrades to no-tool mode
- `max_steps` default: 50; Bash timeout default: 30000ms
- Spec reference: `docs/superpowers/specs/2026-06-30-deepseek-code-phase1-design.md`

---

## File Structure (locked in here, referenced by all tasks)

```
deepseek-code/
├── package.json                              # workspace root, scripts: build/test/lint
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts                          # root config with coverage
├── .gitignore
├── .github/workflows/ci.yml
├── README.md
├── packages/
│   ├── core/
│   │   ├── package.json                      # name: @deepseek-code/core
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                      # public re-exports
│   │   │   ├── types.ts                      # Message, ToolSchema, ProviderEvent, AgentEvent
│   │   │   ├── errors.ts                     # DeepseekCodeError
│   │   │   ├── logger.ts                     # Logger interface + ConsoleLogger + JsonlLogger
│   │   │   ├── config.ts                     # loadConfig from ~/.deepseek-code/config.json
│   │   │   ├── provider/
│   │   │   │   ├── types.ts                  # Provider interface
│   │   │   │   ├── sse.ts                    # parseSSEStream
│   │   │   │   └── deepseek.ts               # DeepseekProvider
│   │   │   ├── tools/
│   │   │   │   ├── types.ts                  # Tool interface, ToolResult, ToolContext
│   │   │   │   └── registry.ts               # ToolRegistry + zod→JSON Schema
│   │   │   ├── permission/
│   │   │   │   ├── types.ts                  # PermissionRule, PermissionRequest
│   │   │   │   ├── bash-matcher.ts           # known-subcommand prefix extraction
│   │   │   │   ├── blacklist.ts              # dangerous patterns
│   │   │   │   └── engine.ts                 # PermissionEngine
│   │   │   ├── session/
│   │   │   │   ├── types.ts                  # Session, SessionStore
│   │   │   │   └── memory.ts                 # MemorySessionStore
│   │   │   └── agent/
│   │   │       ├── events.ts                 # AgentEvent type + emitter
│   │   │       └── loop.ts                   # runAgentLoop
│   │   └── test/...                          # mirrors src/
│   ├── tools/
│   │   ├── package.json                      # name: @deepseek-code/tools
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                      # exports all 5 tools
│   │   │   ├── read.ts
│   │   │   ├── edit.ts
│   │   │   ├── write.ts
│   │   │   ├── bash.ts
│   │   │   └── grep.ts
│   │   └── test/...
│   └── cli/
│       ├── package.json                      # name: deepseek-code, bin: deepseek-code
│       ├── tsconfig.json
│       ├── bin/deepseek-code                 # shebang launcher → dist/main.js
│       ├── src/
│       │   ├── main.ts                       # commander entry
│       │   ├── repl.ts                       # readline REPL
│       │   ├── login.ts                      # interactive apiKey paste
│       │   ├── permission-prompt.ts          # ask interaction
│       │   └── render/
│       │       ├── stream.ts                 # AgentEvent → terminal
│       │       └── format.ts                 # color helpers
│       └── test/...
└── docs/superpowers/specs/2026-06-30-deepseek-code-phase1-design.md
```

---

## Task 1: Monorepo scaffold + tooling baseline

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore` (extend existing)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/tools/package.json`
- Create: `packages/tools/tsconfig.json`
- Create: `packages/tools/src/index.ts`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/main.ts`

**Interfaces:**
- Consumes: nothing
- Produces: workspace structure that `pnpm install && pnpm -r build && pnpm -r test` runs green on (with empty placeholder tests)

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "deepseek-code-root",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "typecheck": "pnpm -r typecheck",
    "lint": "echo 'lint placeholder'"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0"
  }
}
```

- [ ] **Step 2: `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 4: `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'packages/tools/src/**'],
      thresholds: { statements: 80, branches: 80, lines: 80, functions: 80 },
    },
  },
});
```

- [ ] **Step 5: `.gitignore`**

```
node_modules/
dist/
coverage/
*.log
.DS_Store
.deepseek-code/
```

- [ ] **Step 6: `packages/core/package.json`**

```json
{
  "name": "@deepseek-code/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0",
    "eventsource-parser": "^3.0.0"
  }
}
```

- [ ] **Step 7: `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 8: `packages/core/src/index.ts`**

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 9: `packages/tools/package.json`**

```json
{
  "name": "@deepseek-code/tools",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@deepseek-code/core": "workspace:*",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 10: `packages/tools/tsconfig.json`** (identical to core's)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 11: `packages/tools/src/index.ts`**

```ts
export const TOOLS_VERSION = '0.1.0';
```

- [ ] **Step 12: `packages/cli/package.json`**

```json
{
  "name": "deepseek-code",
  "version": "0.1.0",
  "type": "module",
  "bin": { "deepseek-code": "./bin/deepseek-code" },
  "main": "./dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@deepseek-code/core": "workspace:*",
    "@deepseek-code/tools": "workspace:*",
    "commander": "^12.0.0",
    "picocolors": "^1.0.0"
  }
}
```

- [ ] **Step 13: `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 14: `packages/cli/src/main.ts`**

```ts
export function placeholder(): string {
  return 'deepseek-code v0.1.0';
}
```

- [ ] **Step 15: Install and verify**

Run:
```bash
pnpm install
pnpm -r build
pnpm -r typecheck
```
Expected: all three succeed; `packages/*/dist/` populated.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with core/tools/cli packages"
```

---

## Task 2: Core types + DeepseekCodeError

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/test/errors.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Message` (system/user/assistant/tool), `ToolSchema`, `Usage`
  - `ProviderEvent` union: `{type:'text_delta',text}` | `{type:'thinking_delta',text}` | `{type:'tool_call_delta',id,name?,argsDelta}` | `{type:'tool_call_done',id,name,args:object}` | `{type:'usage',usage}` | `{type:'finish',reason:'stop'|'tool_calls'|'length'}`
  - `AgentEvent` union (see spec §4)
  - `DeepseekCodeError extends Error` with `code`, `recoverable`, `userMessage`, `cause`

- [ ] **Step 1: Failing test — `packages/core/test/errors.test.ts`**

```ts
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
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/core/test/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/errors.ts`**

```ts
export interface DeepseekCodeErrorInit {
  code: string;
  message: string;
  userMessage: string;
  recoverable?: boolean;
  cause?: unknown;
}

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
```

- [ ] **Step 4: Implement `packages/core/src/types.ts`**

```ts
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;          // for role='tool'
  name?: string;                  // for role='tool'
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };  // JSON-stringified
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;            // JSON Schema
  };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_delta'; id: string; name?: string; argsDelta: string }
  | { type: 'tool_call_done'; id: string; name: string; args: unknown }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' };

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string; input: unknown }
  | { type: 'tool_call_result'; id: string; result: ToolResultEnvelope }
  | { type: 'step_done'; step: number }
  | { type: 'error'; error: { code: string; userMessage: string } }
  | { type: 'done'; reason: 'natural' | 'max_steps' | 'abort' | 'fatal' };

export interface ToolResultEnvelope {
  ok: boolean;
  output?: unknown;
  display?: string;
  error?: string;
}
```

- [ ] **Step 5: Update `packages/core/src/index.ts`**

```ts
export const VERSION = '0.1.0';
export * from './types.js';
export * from './errors.js';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm vitest run packages/core/test/errors.test.ts && pnpm -r typecheck`
Expected: PASS on tests, typecheck succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add Message/ProviderEvent/AgentEvent types and DeepseekCodeError"
```

---

## Task 3: Logger

**Files:**
- Create: `packages/core/src/logger.ts`
- Create: `packages/core/test/logger.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Logger` interface: `debug/info/warn/error(msg, fields?)`, `event(type, payload)`
  - `ConsoleLogger`: prints to stderr (so it does not corrupt stdout streams)
  - `JsonlLogger`: appends one JSON line per call to a file path
  - `NullLogger`: no-op (default in tests)

- [ ] **Step 1: Failing test — `packages/core/test/logger.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlLogger, NullLogger } from '../src/logger.js';

describe('Logger', () => {
  it('NullLogger is no-op', () => {
    const l = new NullLogger();
    expect(() => l.info('x', { a: 1 })).not.toThrow();
    expect(() => l.event('done', {})).not.toThrow();
  });

  it('JsonlLogger writes one JSON object per line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsclog-'));
    const file = join(dir, 'log.jsonl');
    const l = new JsonlLogger(file);
    l.info('hello', { x: 1 });
    l.event('tool_call', { name: 'Read' });
    await l.flush();
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.level).toBe('info');
    expect(first.msg).toBe('hello');
    expect(first.x).toBe(1);
    expect(typeof first.ts).toBe('string');
    const second = JSON.parse(lines[1]);
    expect(second.type).toBe('tool_call');
    expect(second.name).toBe('Read');
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/core/test/logger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/logger.ts`**

```ts
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
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  event(): void {}
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
```

- [ ] **Step 4: Update `packages/core/src/index.ts`**

```ts
export const VERSION = '0.1.0';
export * from './types.js';
export * from './errors.js';
export * from './logger.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/core/test/logger.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add Logger interface with Null/Console/Jsonl implementations"
```

---

## Task 4: Config loader

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `packages/core/test/config.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `DeepseekCodeError`
- Produces:
  - `Config` shape: `{ apiKey, model, baseUrl, bashTimeoutMs, maxSteps }`
  - `loadConfig(opts?: { homeDir?: string })`: reads `<home>/.deepseek-code/config.json`, applies defaults, validates with zod. Throws `DeepseekCodeError(code='CONFIG_MISSING_KEY' | 'CONFIG_INVALID')` on failure.
  - `writeConfig(cfg, opts?)`: persists to same path with `mkdir -p`.

- [ ] **Step 1: Failing test — `packages/core/test/config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, writeConfig, DEFAULT_CONFIG } from '../src/config.js';
import { DeepseekCodeError } from '../src/errors.js';

function mkHome(): string {
  return mkdtempSync(join(tmpdir(), 'dschome-'));
}

describe('config', () => {
  it('loads with defaults when only apiKey is present', () => {
    const home = mkHome();
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code/config.json'), JSON.stringify({ apiKey: 'sk-abc' }));
    const cfg = loadConfig({ homeDir: home });
    expect(cfg.apiKey).toBe('sk-abc');
    expect(cfg.model).toBe(DEFAULT_CONFIG.model);
    expect(cfg.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(cfg.bashTimeoutMs).toBe(DEFAULT_CONFIG.bashTimeoutMs);
    expect(cfg.maxSteps).toBe(DEFAULT_CONFIG.maxSteps);
    rmSync(home, { recursive: true, force: true });
  });

  it('throws CONFIG_MISSING_KEY when file absent', () => {
    const home = mkHome();
    expect(() => loadConfig({ homeDir: home })).toThrow(DeepseekCodeError);
    try { loadConfig({ homeDir: home }); } catch (e: any) {
      expect(e.code).toBe('CONFIG_MISSING_KEY');
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('throws CONFIG_INVALID on bad JSON', () => {
    const home = mkHome();
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code/config.json'), '{not json');
    try { loadConfig({ homeDir: home }); } catch (e: any) {
      expect(e.code).toBe('CONFIG_INVALID');
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('writeConfig round-trips', () => {
    const home = mkHome();
    writeConfig({ apiKey: 'sk-x', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', bashTimeoutMs: 30000, maxSteps: 50 }, { homeDir: home });
    const cfg = loadConfig({ homeDir: home });
    expect(cfg.apiKey).toBe('sk-x');
    rmSync(home, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/core/test/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/config.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { DeepseekCodeError } from './errors.js';

export const DEFAULT_CONFIG = {
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  bashTimeoutMs: 30000,
  maxSteps: 50,
} as const;

const ConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default(DEFAULT_CONFIG.model),
  baseUrl: z.string().url().default(DEFAULT_CONFIG.baseUrl),
  bashTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.bashTimeoutMs),
  maxSteps: z.number().int().positive().default(DEFAULT_CONFIG.maxSteps),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface LoadConfigOpts { homeDir?: string }

function configPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.deepseek-code', 'config.json');
}

export function loadConfig(opts: LoadConfigOpts = {}): Config {
  const p = configPath(opts.homeDir);
  if (!existsSync(p)) {
    throw new DeepseekCodeError({
      code: 'CONFIG_MISSING_KEY',
      message: `config file not found: ${p}`,
      userMessage: '未找到配置文件，请先运行 `deepseek-code login` 设置 API key',
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (cause) {
    throw new DeepseekCodeError({
      code: 'CONFIG_INVALID',
      message: 'config file is not valid JSON',
      userMessage: `配置文件格式错误：${p}`,
      cause,
    });
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeepseekCodeError({
      code: 'CONFIG_INVALID',
      message: parsed.error.message,
      userMessage: '配置文件字段不合法，请检查 apiKey 等字段',
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function writeConfig(cfg: Config, opts: LoadConfigOpts = {}): void {
  const p = configPath(opts.homeDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2));
}
```

- [ ] **Step 4: Re-export from `packages/core/src/index.ts`**

```ts
export const VERSION = '0.1.0';
export * from './types.js';
export * from './errors.js';
export * from './logger.js';
export * from './config.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/core/test/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add config loader with defaults, zod validation, and writeConfig"
```

---

## Task 5: SSE parser + Provider abstraction

**Files:**
- Create: `packages/core/src/provider/types.ts`
- Create: `packages/core/src/provider/sse.ts`
- Create: `packages/core/test/provider/sse.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Message`, `ToolSchema`, `ProviderEvent` from `types.ts`
- Produces:
  - `Provider` interface: `stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>`
  - `ChatRequest`: `{ model, messages, tools?, temperature? }`
  - `parseSSEStream(body: ReadableStream<Uint8Array>): AsyncIterable<string>` — yields each `data:` payload (raw string, including `[DONE]` sentinel; caller filters)

- [ ] **Step 1: Failing test — `packages/core/test/provider/sse.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../../src/provider/sse.js';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}

describe('parseSSEStream', () => {
  it('yields data payloads from well-formed SSE', async () => {
    const stream = streamFromChunks([
      'data: {"a":1}\n\n',
      'data: {"b":2}\n\ndata: [DONE]\n\n',
    ]);
    const out: string[] = [];
    for await (const ev of parseSSEStream(stream)) out.push(ev);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });

  it('handles split chunks across packet boundaries', async () => {
    const stream = streamFromChunks([
      'data: {"a"',
      ':1}\n\ndata: {"b":2}\n\n',
    ]);
    const out: string[] = [];
    for await (const ev of parseSSEStream(stream)) out.push(ev);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/core/test/provider/sse.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/core/src/provider/sse.ts`**

```ts
import { createParser, EventSourceMessage } from 'eventsource-parser';

export async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: string[] = [];
  const parser = createParser({
    onEvent(ev: EventSourceMessage) { if (ev.data !== undefined) queue.push(ev.data); },
  });

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    while (queue.length) yield queue.shift()!;
  }
  while (queue.length) yield queue.shift()!;
}
```

- [ ] **Step 4: Implement `packages/core/src/provider/types.ts`**

```ts
import type { Message, ToolSchema, ProviderEvent } from '../types.js';

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  temperature?: number;
}

export interface Provider {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
```

- [ ] **Step 5: Re-export from index**

Append to `packages/core/src/index.ts`:

```ts
export * from './provider/types.js';
export * from './provider/sse.js';
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run packages/core/test/provider/sse.test.ts && pnpm -r typecheck`
Expected: PASS and typecheck succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add Provider interface and SSE stream parser"
```

---

## Task 6: DeepSeek provider implementation

**Files:**
- Create: `packages/core/src/provider/deepseek.ts`
- Create: `packages/core/test/provider/deepseek.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Provider`, `ChatRequest`, `ProviderEvent`, `parseSSEStream`, `DeepseekCodeError`
- Produces:
  - `DeepseekProvider` class implementing `Provider`
  - Constructor: `new DeepseekProvider({ apiKey, baseUrl, fetch?, retry? })`
  - Behavior:
    - POST `<baseUrl>/chat/completions` with `stream: true` and OpenAI-compatible body
    - For each SSE `data:` chunk (skipping `[DONE]`), parse choices[0].delta and emit `ProviderEvent`s:
      - `delta.content` → `text_delta`
      - `delta.reasoning_content` → `thinking_delta`
      - `delta.tool_calls[i]` → `tool_call_delta` (id stable per index, args concatenated)
      - When `finish_reason` appears, finalize each accumulated tool_call as `tool_call_done` (parse JSON args; on parse error throw `DeepseekCodeError(code='PROVIDER_TOOL_ARGS_INVALID')`) then emit `usage` (if present) and `finish`
    - 429 / 5xx: exponential backoff retry up to 3 times (1s/2s/4s caps at 8s); other 4xx throws immediately (`PROVIDER_AUTH` for 401/403, otherwise `PROVIDER_HTTP_<status>`)
    - Mid-stream disconnect: retry the whole call once; if it disconnects again, throw `PROVIDER_STREAM_BROKEN`
    - `AbortSignal` aborts in-flight fetch and stops iteration

- [ ] **Step 1: Add msw dev dep**

In root `package.json` devDependencies add `"msw": "^2.3.0"`. Run `pnpm install`.

- [ ] **Step 2: Failing test — `packages/core/test/provider/deepseek.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { DeepseekProvider } from '../../src/provider/deepseek.js';
import type { ProviderEvent } from '../../src/types.js';
import { DeepseekCodeError } from '../../src/errors.js';

const URL = 'https://api.deepseek.com/v1/chat/completions';

function sseBody(lines: string[]): Response {
  const body = lines.map(l => `data: ${l}\n\n`).join('');
  return new HttpResponse(body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function collect(p: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of p) out.push(e);
  return out;
}

describe('DeepseekProvider', () => {
  it('emits text_delta then finish', async () => {
    server.use(http.post(URL, () => sseBody([
      JSON.stringify({ choices: [{ delta: { content: 'hello ' }, index: 0 }] }),
      JSON.stringify({ choices: [{ delta: { content: 'world' }, index: 0 }] }),
      JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }),
      '[DONE]',
    ])));
    const p = new DeepseekProvider({ apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1' });
    const events = await collect(p.stream(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    ));
    expect(events[0]).toEqual({ type: 'text_delta', text: 'hello ' });
    expect(events[1]).toEqual({ type: 'text_delta', text: 'world' });
    expect(events.find(e => e.type === 'usage')).toBeDefined();
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('separates reasoning_content as thinking_delta', async () => {
    server.use(http.post(URL, () => sseBody([
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking...' }, index: 0 }] }),
      JSON.stringify({ choices: [{ delta: { content: 'answer' }, index: 0 }] }),
      JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] }),
      '[DONE]',
    ])));
    const p = new DeepseekProvider({ apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1' });
    const events = await collect(p.stream(
      { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    ));
    expect(events[0]).toEqual({ type: 'thinking_delta', text: 'thinking...' });
    expect(events[1]).toEqual({ type: 'text_delta', text: 'answer' });
  });

  it('assembles tool_call across deltas and emits tool_call_done', async () => {
    server.use(http.post(URL, () => sseBody([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"file_path":"' } }] }, index: 0 }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '/tmp/a.txt"}' } }] }, index: 0 }] }),
      JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] }),
      '[DONE]',
    ])));
    const p = new DeepseekProvider({ apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1' });
    const events = await collect(p.stream(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'read' }] },
      new AbortController().signal,
    ));
    const done = events.find(e => e.type === 'tool_call_done');
    expect(done).toEqual({ type: 'tool_call_done', id: 'call_1', name: 'Read', args: { file_path: '/tmp/a.txt' } });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    server.use(http.post(URL, () => {
      calls++;
      if (calls < 2) return new HttpResponse('rate', { status: 429 });
      return sseBody([
        JSON.stringify({ choices: [{ delta: { content: 'ok' }, index: 0 }] }),
        JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] }),
        '[DONE]',
      ]);
    }));
    const p = new DeepseekProvider({
      apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1',
      retry: { initialMs: 1, maxAttempts: 3 },
    });
    const events = await collect(p.stream(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    ));
    expect(calls).toBe(2);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'ok' });
  });

  it('throws PROVIDER_AUTH on 401', async () => {
    server.use(http.post(URL, () => new HttpResponse('unauth', { status: 401 })));
    const p = new DeepseekProvider({ apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1' });
    await expect(collect(p.stream(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    ))).rejects.toMatchObject({ code: 'PROVIDER_AUTH' });
  });

  it('aborts in-flight stream when signal fires', async () => {
    server.use(http.post(URL, async () => {
      await new Promise(r => setTimeout(r, 500));
      return sseBody(['{}', '[DONE]']);
    }));
    const ctl = new AbortController();
    const p = new DeepseekProvider({ apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1' });
    const iter = p.stream({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }, ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    await expect(collect(iter)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run — expect fail**

Run: `pnpm vitest run packages/core/test/provider/deepseek.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/core/src/provider/deepseek.ts`**

```ts
import type { Provider, ChatRequest } from './types.js';
import type { ProviderEvent } from '../types.js';
import { parseSSEStream } from './sse.js';
import { DeepseekCodeError } from '../errors.js';

export interface RetryOpts {
  initialMs?: number;
  maxAttempts?: number;
  maxMs?: number;
}

export interface DeepseekProviderOpts {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  retry?: RetryOpts;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

export class DeepseekProvider implements Provider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly initialMs: number;
  private readonly maxAttempts: number;
  private readonly maxMs: number;

  constructor(opts: DeepseekProviderOpts) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
    this.initialMs = opts.retry?.initialMs ?? 1000;
    this.maxAttempts = opts.retry?.maxAttempts ?? 3;
    this.maxMs = opts.retry?.maxMs ?? 8000;
  }

  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const body = JSON.stringify({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      stream: true,
      temperature: req.temperature,
    });
    let resp: Response | null = null;
    let attempt = 0;
    let delay = this.initialMs;
    while (true) {
      attempt++;
      try {
        resp = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${this.apiKey}`,
          },
          body,
          signal,
        });
      } catch (cause) {
        if (signal.aborted) throw new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消', cause });
        if (attempt >= this.maxAttempts) throw new DeepseekCodeError({ code: 'PROVIDER_NETWORK', message: 'network error', userMessage: '网络错误，请检查连接', cause });
        await sleep(Math.min(delay, this.maxMs), signal);
        delay *= 2;
        continue;
      }
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt >= this.maxAttempts) {
          throw new DeepseekCodeError({
            code: `PROVIDER_HTTP_${resp.status}`,
            message: `http ${resp.status}`,
            userMessage: resp.status === 429 ? '请求过于频繁，请稍后再试' : `DeepSeek 服务异常 (HTTP ${resp.status})`,
            recoverable: true,
          });
        }
        await sleep(Math.min(delay, this.maxMs), signal);
        delay *= 2;
        continue;
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new DeepseekCodeError({ code: 'PROVIDER_AUTH', message: `http ${resp.status}`, userMessage: 'API key 无效或权限不足' });
      }
      if (!resp.ok) {
        const text = await safeText(resp);
        throw new DeepseekCodeError({ code: `PROVIDER_HTTP_${resp.status}`, message: `http ${resp.status}: ${text}`, userMessage: `DeepSeek 调用失败：HTTP ${resp.status}` });
      }
      break;
    }
    if (!resp.body) throw new DeepseekCodeError({ code: 'PROVIDER_STREAM_BROKEN', message: 'no body', userMessage: '响应流为空' });

    const accumulators = new Map<number, ToolCallAccumulator>();

    try {
      for await (const data of parseSSEStream(resp.body)) {
        if (data === '[DONE]') continue;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        const choice = chunk.choices?.[0];
        if (!choice) {
          if (chunk.usage) yield { type: 'usage', usage: chunk.usage };
          continue;
        }
        const delta = choice.delta ?? {};
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length) {
          yield { type: 'thinking_delta', text: delta.reasoning_content };
        }
        if (typeof delta.content === 'string' && delta.content.length) {
          yield { type: 'text_delta', text: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const acc = accumulators.get(idx) ?? { id: '', name: '', args: '' };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
            accumulators.set(idx, acc);
            yield { type: 'tool_call_delta', id: acc.id, name: tc.function?.name, argsDelta: tc.function?.arguments ?? '' };
          }
        }
        if (choice.finish_reason) {
          for (const acc of accumulators.values()) {
            let args: unknown;
            try { args = acc.args ? JSON.parse(acc.args) : {}; } catch (cause) {
              throw new DeepseekCodeError({
                code: 'PROVIDER_TOOL_ARGS_INVALID',
                message: `failed to parse tool args: ${acc.args}`,
                userMessage: '模型返回的工具参数不是合法 JSON',
                cause,
              });
            }
            yield { type: 'tool_call_done', id: acc.id, name: acc.name, args };
          }
          if (chunk.usage) yield { type: 'usage', usage: chunk.usage };
          yield { type: 'finish', reason: choice.finish_reason };
        }
      }
    } catch (e) {
      if ((e as any)?.code === 'ABORT_ERR' || signal.aborted) {
        throw new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消', cause: e });
      }
      throw e;
    }
  }
}

async function safeText(r: Response): Promise<string> {
  try { return await r.text(); } catch { return ''; }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消' }));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new DeepseekCodeError({ code: 'ABORTED', message: 'aborted', userMessage: '已取消' })); }, { once: true });
  });
}
```

- [ ] **Step 5: Re-export**

Append to `packages/core/src/index.ts`:

```ts
export * from './provider/deepseek.js';
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run packages/core/test/provider/deepseek.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add DeepSeek provider with SSE, R1 split, retry, abort"
```

---

## Task 7: Tool interface + ToolRegistry (with zod → JSON Schema)

**Files:**
- Create: `packages/core/src/tools/types.ts`
- Create: `packages/core/src/tools/registry.ts`
- Create: `packages/core/test/tools/registry.test.ts`
- Modify: `packages/core/src/index.ts`
- Add dependency: `zod-to-json-schema@^3.23.0` to `packages/core/package.json`

**Interfaces:**
- Consumes: `ToolSchema` from `types.ts`, `Logger`
- Produces:
  - `ToolContext`: `{ cwd: string; signal: AbortSignal; logger: Logger }`
  - `ToolResult<O>`: `{ ok: true; output: O; display?: string } | { ok: false; error: string; recoverable: boolean }`
  - `PermissionRequest`: `{ tool: string; matcher: string; summary: string }` (used by `Tool.needsPermission`)
  - `Tool<I, O>` interface: `{ name, description, inputSchema, needsPermission(input), execute(input, ctx) }`
  - `ToolRegistry` with `register(tool)`, `get(name)`, `list()`, `toSchemas(): ToolSchema[]`

- [ ] **Step 1: Install zod-to-json-schema**

Edit `packages/core/package.json` dependencies — add `"zod-to-json-schema": "^3.23.0"`. Run `pnpm install`.

- [ ] **Step 2: Failing test — `packages/core/test/tools/registry.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const echoTool: Tool<{ msg: string }, { echoed: string }> = {
  name: 'Echo',
  description: 'echoes input',
  inputSchema: z.object({ msg: z.string() }),
  needsPermission: () => null,
  async execute(input) { return { ok: true, output: { echoed: input.msg } }; },
};

describe('ToolRegistry', () => {
  it('registers and looks up tools', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    expect(r.get('Echo')).toBe(echoTool);
    expect(r.list().map(t => t.name)).toEqual(['Echo']);
  });

  it('rejects duplicate names', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    expect(() => r.register(echoTool)).toThrow(/duplicate/i);
  });

  it('toSchemas produces OpenAI tools format', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    const schemas = r.toSchemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].type).toBe('function');
    expect(schemas[0].function.name).toBe('Echo');
    expect(schemas[0].function.description).toBe('echoes input');
    expect(schemas[0].function.parameters).toMatchObject({ type: 'object' });
  });
});
```

- [ ] **Step 3: Run — expect fail**

Run: `pnpm vitest run packages/core/test/tools/registry.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `packages/core/src/tools/types.ts`**

```ts
import type { ZodType } from 'zod';
import type { Logger } from '../logger.js';

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  logger: Logger;
}

export type ToolResult<O> =
  | { ok: true; output: O; display?: string }
  | { ok: false; error: string; recoverable: boolean };

export interface PermissionRequest {
  tool: string;
  matcher: string;       // tool-internal: bash prefix, file path, etc.
  summary: string;       // human-readable
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  needsPermission(input: I): PermissionRequest | null;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}
```

- [ ] **Step 5: Implement `packages/core/src/tools/registry.ts`**

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool } from './types.js';
import type { ToolSchema } from '../types.js';

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
    return this.list().map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema, { target: 'openApi3' }) as object,
      },
    }));
  }
}
```

- [ ] **Step 6: Re-export**

Append to `packages/core/src/index.ts`:

```ts
export * from './tools/types.js';
export * from './tools/registry.js';
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run packages/core/test/tools/registry.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add Tool interface and ToolRegistry with zod→JSON Schema"
```

---

## Task 8: Read tool

**Files:**
- Create: `packages/tools/src/read.ts`
- Create: `packages/tools/test/read.test.ts`
- Modify: `packages/tools/src/index.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolContext`, `ToolResult` from `@deepseek-code/core`
- Produces:
  - `readTool: Tool<ReadInput, ReadOutput>`
  - `ReadInput = { file_path: string; offset?: number; limit?: number }`
  - `ReadOutput = { content: string; totalLines: number; truncated: boolean }`
  - Behavior: absolute path required; `cat -n` style line numbers prefixed `<n>\t`; default limit 2000 lines; binary detection (NUL byte in first 8KB) → `{ ok:false, error:'binary_file', recoverable:false }`; non-existent → `{ ok:false, error:'file_not_found', recoverable:true }`
  - `needsPermission`: returns null (read is always allowed)

- [ ] **Step 1: Failing test — `packages/tools/test/read.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTool } from '../src/read.js';
import { NullLogger } from '@deepseek-code/core';

function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger() };
}

describe('Read tool', () => {
  it('reads a small file with line numbers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'line1\nline2\nline3\n');
    const r = await readTool.execute({ file_path: f }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.content).toBe('1\tline1\n2\tline2\n3\tline3');
      expect(r.output.totalLines).toBe(3);
      expect(r.output.truncated).toBe(false);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies offset and limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, [1,2,3,4,5].map(n => `L${n}`).join('\n'));
    const r = await readTool.execute({ file_path: f, offset: 2, limit: 2 }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.content).toBe('2\tL2\n3\tL3');
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects binary file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-'));
    const f = join(dir, 'b.bin');
    writeFileSync(f, Buffer.from([0x00, 0x01, 0x02]));
    const r = await readTool.execute({ file_path: f }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('binary_file');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns file_not_found for missing file', async () => {
    const r = await readTool.execute({ file_path: '/nonexistent/zzz.txt' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('file_not_found');
  });

  it('rejects relative path via schema', () => {
    const parsed = readTool.inputSchema.safeParse({ file_path: 'rel/path.txt' });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/tools/test/read.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/tools/src/read.ts`**

```ts
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  file_path: z.string().refine(isAbsolute, { message: 'file_path must be absolute' }),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(10000).optional(),
});

export interface ReadOutput {
  content: string;
  totalLines: number;
  truncated: boolean;
}

const DEFAULT_LIMIT = 2000;

function isBinary(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } finally { closeSync(fd); }
}

export const readTool: Tool<z.infer<typeof InputSchema>, ReadOutput> = {
  name: 'Read',
  description: '读取本地文件，返回带行号的内容（cat -n 风格）。file_path 必须是绝对路径。',
  inputSchema: InputSchema,
  needsPermission: () => null,
  async execute(input) {
    if (!existsSync(input.file_path)) {
      return { ok: false, error: 'file_not_found', recoverable: true };
    }
    if (isBinary(input.file_path)) {
      return { ok: false, error: 'binary_file', recoverable: false };
    }
    const raw = readFileSync(input.file_path, 'utf8');
    const allLines = raw.split('\n');
    if (allLines.length && allLines[allLines.length - 1] === '') allLines.pop();
    const totalLines = allLines.length;
    const offset = input.offset ?? 1;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const startIdx = offset - 1;
    const endIdx = Math.min(startIdx + limit, totalLines);
    const truncated = endIdx < totalLines || startIdx > 0;
    const numbered = allLines.slice(startIdx, endIdx)
      .map((line, i) => `${startIdx + i + 1}\t${line}`)
      .join('\n');
    return { ok: true, output: { content: numbered, totalLines, truncated }, display: numbered };
  },
};
```

- [ ] **Step 4: Update `packages/tools/src/index.ts`**

```ts
export { readTool } from './read.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/tools/test/read.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tools): add Read tool with line numbering, offset/limit, binary detection"
```

---

## Task 9: Grep tool

**Files:**
- Create: `packages/tools/src/grep.ts`
- Create: `packages/tools/test/grep.test.ts`
- Modify: `packages/tools/src/index.ts`

**Interfaces:**
- Consumes: `Tool` from core
- Produces:
  - `grepTool: Tool<GrepInput, GrepOutput>` — wraps `rg` (ripgrep) via `node:child_process.spawnSync`
  - `GrepInput = { pattern: string; path?: string; glob?: string; case_insensitive?: boolean; show_line_numbers?: boolean; context?: number }`
  - `GrepOutput = { matches: string; truncated: boolean }`
  - On missing `rg` binary → `{ ok:false, error:'ripgrep_not_installed', recoverable:false }`
  - `needsPermission`: returns null

- [ ] **Step 1: Failing test — `packages/tools/test/grep.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grepTool } from '../src/grep.js';
import { NullLogger } from '@deepseek-code/core';

function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger() };
}

describe('Grep tool', () => {
  it('finds matches in a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-'));
    writeFileSync(join(dir, 'a.ts'), 'const foo = 1;\nconst bar = 2;\n');
    writeFileSync(join(dir, 'b.ts'), 'export const baz = 3;\n');
    const r = await grepTool.execute({ pattern: 'const \\w+', path: dir, show_line_numbers: true }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.matches).toMatch(/foo/);
      expect(r.output.matches).toMatch(/bar/);
      expect(r.output.matches).toMatch(/baz/);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('respects case_insensitive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-'));
    writeFileSync(join(dir, 'a.ts'), 'Hello World\n');
    const r = await grepTool.execute({ pattern: 'hello', path: dir, case_insensitive: true }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.matches).toMatch(/Hello World/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty matches when nothing found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-'));
    writeFileSync(join(dir, 'a.ts'), 'nothing here\n');
    const r = await grepTool.execute({ pattern: 'zzz_no_match', path: dir }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.matches).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/tools/test/grep.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/tools/src/grep.ts`**

```ts
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  glob: z.string().optional(),
  case_insensitive: z.boolean().optional(),
  show_line_numbers: z.boolean().optional(),
  context: z.number().int().min(0).max(20).optional(),
});

export interface GrepOutput {
  matches: string;
  truncated: boolean;
}

const MAX_BYTES = 1024 * 256;

export const grepTool: Tool<z.infer<typeof InputSchema>, GrepOutput> = {
  name: 'Grep',
  description: '使用 ripgrep 在文件/目录中搜索正则模式，返回匹配行。',
  inputSchema: InputSchema,
  needsPermission: () => null,
  async execute(input, ctx) {
    const args: string[] = [];
    if (input.case_insensitive) args.push('-i');
    if (input.show_line_numbers) args.push('-n');
    if (typeof input.context === 'number') args.push('-C', String(input.context));
    if (input.glob) args.push('-g', input.glob);
    args.push('--', input.pattern);
    if (input.path) args.push(input.path);
    const res = spawnSync('rg', args, { cwd: ctx.cwd, encoding: 'utf8', maxBuffer: MAX_BYTES, signal: ctx.signal });
    if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'ripgrep_not_installed', recoverable: false };
    }
    if (res.status !== 0 && res.status !== 1) {
      return { ok: false, error: `rg exited ${res.status}: ${res.stderr}`, recoverable: true };
    }
    const out = res.stdout ?? '';
    return { ok: true, output: { matches: out.trim(), truncated: out.length >= MAX_BYTES }, display: out };
  },
};
```

- [ ] **Step 4: Update `packages/tools/src/index.ts`**

```ts
export { readTool } from './read.js';
export { grepTool } from './grep.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/tools/test/grep.test.ts`
Expected: PASS (requires `rg` on PATH; CI must install ripgrep).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tools): add Grep tool wrapping ripgrep with glob and context support"
```

---

## Task 10: Bash tool

**Files:**
- Create: `packages/tools/src/bash.ts`
- Create: `packages/tools/test/bash.test.ts`
- Modify: `packages/tools/src/index.ts`

**Interfaces:**
- Consumes: `Tool`, `PermissionRequest`
- Produces:
  - `bashTool: Tool<BashInput, BashOutput>`
  - `BashInput = { command: string; timeout_ms?: number }`
  - `BashOutput = { stdout: string; stderr: string; exit_code: number; timed_out: boolean }`
  - `needsPermission`: always returns `{ tool: 'Bash', matcher: <prefix>, summary: command }` (engine decides)
  - Behavior: `spawn('bash', ['-c', cmd])`, captures stdout+stderr separately, hard timeout via signal, max output 256KB per stream (truncate with `\n...[truncated]\n`)

- [ ] **Step 1: Failing test — `packages/tools/test/bash.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { bashTool } from '../src/bash.js';
import { NullLogger } from '@deepseek-code/core';

function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger() };
}

describe('Bash tool', () => {
  it('runs a simple command', async () => {
    const r = await bashTool.execute({ command: 'echo hello' }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.stdout.trim()).toBe('hello');
      expect(r.output.exit_code).toBe(0);
      expect(r.output.timed_out).toBe(false);
    }
  });

  it('captures stderr and non-zero exit', async () => {
    const r = await bashTool.execute({ command: 'echo oops >&2; exit 3' }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.stderr.trim()).toBe('oops');
      expect(r.output.exit_code).toBe(3);
    }
  });

  it('times out long commands', async () => {
    const r = await bashTool.execute({ command: 'sleep 5', timeout_ms: 100 }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.timed_out).toBe(true);
  });

  it('emits PermissionRequest with prefix matcher', () => {
    const pr = bashTool.needsPermission({ command: 'git status -s' });
    expect(pr).not.toBeNull();
    expect(pr!.tool).toBe('Bash');
    expect(pr!.matcher).toBe('git status');
  });

  it('single-token command yields single-token matcher', () => {
    const pr = bashTool.needsPermission({ command: 'ls -la /tmp' });
    expect(pr!.matcher).toBe('ls');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/tools/test/bash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/tools/src/bash.ts`**

```ts
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  command: z.string().min(1),
  timeout_ms: z.number().int().positive().max(600_000).optional(),
});

export interface BashOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

const KNOWN_SUBCOMMAND_TOOLS = new Set(['git','npm','pnpm','yarn','pip','pip3','cargo','go','kubectl','docker','python','python3','node','rustc']);
const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT = 256 * 1024;

export function commandPrefix(cmd: string): string {
  const tokens = cmd.trim().split(/\s+/);
  if (tokens.length >= 2 && KNOWN_SUBCOMMAND_TOOLS.has(tokens[0])) {
    return `${tokens[0]} ${tokens[1]}`;
  }
  return tokens[0] ?? '';
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + '\n...[truncated]\n';
}

export const bashTool: Tool<z.infer<typeof InputSchema>, BashOutput> = {
  name: 'Bash',
  description: '执行 shell 命令并返回 stdout/stderr/exit_code。命令会按超时强制终止。',
  inputSchema: InputSchema,
  needsPermission(input) {
    return { tool: 'Bash', matcher: commandPrefix(input.command), summary: input.command };
  },
  async execute(input, ctx) {
    const timeout = input.timeout_ms ?? DEFAULT_TIMEOUT;
    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', input.command], { cwd: ctx.cwd });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
      const onAbort = () => { child.kill('SIGKILL'); };
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', (code) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        resolve({
          ok: true,
          output: {
            stdout: truncate(stdout),
            stderr: truncate(stderr),
            exit_code: code ?? -1,
            timed_out: timedOut,
          },
          display: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
        });
      });
    });
  },
};
```

- [ ] **Step 4: Update `packages/tools/src/index.ts`**

```ts
export { readTool } from './read.js';
export { grepTool } from './grep.js';
export { bashTool, commandPrefix } from './bash.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/tools/test/bash.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tools): add Bash tool with timeout, stdout/stderr capture, prefix matcher"
```

---

## Task 11: Edit tool

**Files:**
- Create: `packages/tools/src/edit.ts`
- Create: `packages/tools/test/edit.test.ts`
- Modify: `packages/tools/src/index.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolContext`
- Produces:
  - `editTool: Tool<EditInput, EditOutput>`
  - `EditInput = { file_path: string; old_string: string; new_string: string }`
  - `EditOutput = { path: string; replaced: 1 }`
  - Errors: `'file_not_found'`, `'not_read_in_session'` (caller must track read files in session — see Task 14; `editTool` itself takes a `readFiles: Set<string>` via `ctx.session`), `'old_string_not_found'`, `'non_unique_match'`, `'identical_strings'`
  - `needsPermission`: returns `{ tool: 'Edit', matcher: absolute path, summary: file_path }`
  - **Session tracking**: tool reads from and writes to a `ctx.session.readFiles` set. Augment `ToolContext` minimally with `session?: { readFiles: Set<string> }`.

- [ ] **Step 1: First, extend `ToolContext` in core**

Edit `packages/core/src/tools/types.ts`:

```ts
import type { ZodType } from 'zod';
import type { Logger } from '../logger.js';

export interface ToolSession {
  readFiles: Set<string>;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  logger: Logger;
  session: ToolSession;
}

export type ToolResult<O> =
  | { ok: true; output: O; display?: string }
  | { ok: false; error: string; recoverable: boolean };

export interface PermissionRequest {
  tool: string;
  matcher: string;
  summary: string;
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  needsPermission(input: I): PermissionRequest | null;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}
```

- [ ] **Step 2: Update existing tool tests to pass session in ctx**

In `packages/tools/test/read.test.ts`, `packages/tools/test/grep.test.ts`, `packages/tools/test/bash.test.ts`, replace the `ctx()` helper:

```ts
function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger(), session: { readFiles: new Set<string>() } };
}
```

- [ ] **Step 3: Update Read tool to record reads**

In `packages/tools/src/read.ts`, inside `execute`, after successful read add:

```ts
ctx.session.readFiles.add(input.file_path);
```

- [ ] **Step 4: Re-run existing tests to confirm green**

Run: `pnpm vitest run packages/tools/test`
Expected: PASS (existing 3 tool test suites still green with the schema change).

- [ ] **Step 5: Failing test — `packages/tools/test/edit.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editTool } from '../src/edit.js';
import { readTool } from '../src/read.js';
import { NullLogger } from '@deepseek-code/core';

function ctx(readFiles: Set<string> = new Set()) {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger(), session: { readFiles } };
}

describe('Edit tool', () => {
  it('replaces unique substring after Read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'const x = 1;\nconst y = 2;\n');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await editTool.execute({ file_path: f, old_string: 'const y = 2;', new_string: 'const y = 99;' }, c);
    expect(r.ok).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe('const x = 1;\nconst y = 99;\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors when file not read in session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'foo');
    const r = await editTool.execute({ file_path: f, old_string: 'foo', new_string: 'bar' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_read_in_session');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors on non-unique old_string', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'dup\ndup\n');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await editTool.execute({ file_path: f, old_string: 'dup', new_string: 'one' }, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('non_unique_match');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors when old_string not found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'foo');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await editTool.execute({ file_path: f, old_string: 'bar', new_string: 'baz' }, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('old_string_not_found');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors when old_string equals new_string', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'foo');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await editTool.execute({ file_path: f, old_string: 'foo', new_string: 'foo' }, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('identical_strings');
    rmSync(dir, { recursive: true, force: true });
  });

  it('PermissionRequest uses absolute path as matcher', () => {
    const pr = editTool.needsPermission({ file_path: '/tmp/a.ts', old_string: 'a', new_string: 'b' });
    expect(pr).toEqual({ tool: 'Edit', matcher: '/tmp/a.ts', summary: '/tmp/a.ts' });
  });
});
```

- [ ] **Step 6: Run — expect fail**

Run: `pnpm vitest run packages/tools/test/edit.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `packages/tools/src/edit.ts`**

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  file_path: z.string().refine(isAbsolute, { message: 'file_path must be absolute' }),
  old_string: z.string(),
  new_string: z.string(),
});

export interface EditOutput {
  path: string;
  replaced: 1;
}

export const editTool: Tool<z.infer<typeof InputSchema>, EditOutput> = {
  name: 'Edit',
  description: '在文件中将 old_string 精确替换为 new_string。old_string 必须在文件中唯一出现。修改前必须先用 Read 读取该文件。',
  inputSchema: InputSchema,
  needsPermission: (input) => ({ tool: 'Edit', matcher: input.file_path, summary: input.file_path }),
  async execute(input, ctx) {
    if (input.old_string === input.new_string) {
      return { ok: false, error: 'identical_strings', recoverable: false };
    }
    if (!existsSync(input.file_path)) {
      return { ok: false, error: 'file_not_found', recoverable: true };
    }
    if (!ctx.session.readFiles.has(input.file_path)) {
      return { ok: false, error: 'not_read_in_session', recoverable: true };
    }
    const content = readFileSync(input.file_path, 'utf8');
    const occurrences = content.split(input.old_string).length - 1;
    if (occurrences === 0) {
      return { ok: false, error: 'old_string_not_found', recoverable: true };
    }
    if (occurrences > 1) {
      return { ok: false, error: 'non_unique_match', recoverable: true };
    }
    writeFileSync(input.file_path, content.replace(input.old_string, input.new_string));
    ctx.session.readFiles.add(input.file_path);
    return { ok: true, output: { path: input.file_path, replaced: 1 }, display: `已替换 ${input.file_path}` };
  },
};
```

- [ ] **Step 8: Update `packages/tools/src/index.ts`**

```ts
export { readTool } from './read.js';
export { grepTool } from './grep.js';
export { bashTool, commandPrefix } from './bash.js';
export { editTool } from './edit.js';
```

- [ ] **Step 9: Run all tool tests**

Run: `pnpm vitest run packages/tools/test`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(tools): add Edit tool with unique-match + read-in-session enforcement"
```

---

## Task 12: Write tool

**Files:**
- Create: `packages/tools/src/write.ts`
- Create: `packages/tools/test/write.test.ts`
- Modify: `packages/tools/src/index.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolContext`
- Produces:
  - `writeTool: Tool<WriteInput, WriteOutput>`
  - `WriteInput = { file_path: string; content: string }`
  - `WriteOutput = { path: string; bytes_written: number }`
  - Behavior: for existing files require `readFiles.has(path)`; for new files allow without read. Auto-creates parent directories. Adds path to `readFiles` after write.

- [ ] **Step 1: Failing test — `packages/tools/test/write.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTool } from '../src/write.js';
import { readTool } from '../src/read.js';
import { NullLogger } from '@deepseek-code/core';

function ctx(readFiles: Set<string> = new Set()) {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger(), session: { readFiles } };
}

describe('Write tool', () => {
  it('writes a new file without prior Read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-'));
    const f = join(dir, 'sub/dir/a.txt');
    const r = await writeTool.execute({ file_path: f, content: 'hello\n' }, ctx());
    expect(r.ok).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe('hello\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('requires Read for existing files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'old');
    const r = await writeTool.execute({ file_path: f, content: 'new' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_read_in_session');
    rmSync(dir, { recursive: true, force: true });
  });

  it('overwrites existing file after Read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'old');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await writeTool.execute({ file_path: f, content: 'new' }, c);
    expect(r.ok).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe('new');
    rmSync(dir, { recursive: true, force: true });
  });

  it('PermissionRequest uses absolute path as matcher', () => {
    const pr = writeTool.needsPermission({ file_path: '/tmp/a.ts', content: 'x' });
    expect(pr).toEqual({ tool: 'Write', matcher: '/tmp/a.ts', summary: '/tmp/a.ts' });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/tools/test/write.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/tools/src/write.ts`**

```ts
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  file_path: z.string().refine(isAbsolute, { message: 'file_path must be absolute' }),
  content: z.string(),
});

export interface WriteOutput {
  path: string;
  bytes_written: number;
}

export const writeTool: Tool<z.infer<typeof InputSchema>, WriteOutput> = {
  name: 'Write',
  description: '向文件写入完整内容（覆盖）。已存在的文件必须先用 Read 读取过。',
  inputSchema: InputSchema,
  needsPermission: (input) => ({ tool: 'Write', matcher: input.file_path, summary: input.file_path }),
  async execute(input, ctx) {
    if (existsSync(input.file_path) && !ctx.session.readFiles.has(input.file_path)) {
      return { ok: false, error: 'not_read_in_session', recoverable: true };
    }
    mkdirSync(dirname(input.file_path), { recursive: true });
    writeFileSync(input.file_path, input.content);
    ctx.session.readFiles.add(input.file_path);
    return { ok: true, output: { path: input.file_path, bytes_written: Buffer.byteLength(input.content, 'utf8') }, display: `已写入 ${input.file_path}` };
  },
};
```

- [ ] **Step 4: Update `packages/tools/src/index.ts`**

```ts
export { readTool } from './read.js';
export { grepTool } from './grep.js';
export { bashTool, commandPrefix } from './bash.js';
export { editTool } from './edit.js';
export { writeTool } from './write.js';
```

- [ ] **Step 5: Run all tool tests**

Run: `pnpm vitest run packages/tools/test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tools): add Write tool with new-file allowance and read-required for existing"
```

---

## Task 13: Permission engine

**Files:**
- Create: `packages/core/src/permission/types.ts`
- Create: `packages/core/src/permission/blacklist.ts`
- Create: `packages/core/src/permission/engine.ts`
- Create: `packages/core/test/permission/engine.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `PermissionRequest` (from `tools/types.ts`)
- Produces:
  - `PermissionRule = { tool: string; matcher: string; decision: 'allow' | 'deny' | 'ask' }`
  - `PermissionScope = 'session' | 'project' | 'global'`
  - `PermissionDecision = 'allow' | 'deny' | 'ask' | 'forbidden'` (forbidden = blacklisted, never asks)
  - `BlacklistMatch = (cmd: string) => boolean` — detects `rm -rf /`, `sudo`, fork bomb
  - `PermissionEngine`:
    - `constructor({ projectRules, globalRules, blacklist })`
    - `check(req: PermissionRequest): PermissionDecision`
    - `remember(req, decision: 'allow' | 'deny', scope: 'session')` — for session-only memory
  - Priority: session > project > global; ask if no rule matches; forbidden overrides everything when tool === 'Bash' and command matches blacklist

- [ ] **Step 1: Failing test — `packages/core/test/permission/engine.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PermissionEngine, isDangerous } from '../../src/permission/engine.js';

describe('isDangerous (blacklist)', () => {
  it('detects rm -rf /', () => {
    expect(isDangerous('rm -rf /')).toBe(true);
    expect(isDangerous('rm -rf /*')).toBe(true);
    expect(isDangerous('rm  -rf  /')).toBe(true);
  });
  it('detects sudo', () => {
    expect(isDangerous('sudo apt install foo')).toBe(true);
  });
  it('detects fork bomb', () => {
    expect(isDangerous(':(){ :|:& };:')).toBe(true);
  });
  it('does not flag harmless rm', () => {
    expect(isDangerous('rm -f /tmp/x')).toBe(false);
    expect(isDangerous('ls -la')).toBe(false);
  });
});

describe('PermissionEngine', () => {
  it('asks by default when no rules', () => {
    const e = new PermissionEngine({});
    expect(e.check({ tool: 'Bash', matcher: 'git status', summary: 'git status' })).toBe('ask');
  });

  it('forbids blacklisted Bash regardless of rules', () => {
    const e = new PermissionEngine({
      projectRules: [{ tool: 'Bash', matcher: 'sudo apt', decision: 'allow' }],
    });
    expect(e.check({ tool: 'Bash', matcher: 'sudo apt', summary: 'sudo apt install foo' })).toBe('forbidden');
  });

  it('global rules apply for any tool', () => {
    const e = new PermissionEngine({
      globalRules: [{ tool: 'Bash', matcher: 'git status', decision: 'allow' }],
    });
    expect(e.check({ tool: 'Bash', matcher: 'git status', summary: 'git status -s' })).toBe('allow');
  });

  it('project rules override global', () => {
    const e = new PermissionEngine({
      globalRules: [{ tool: 'Bash', matcher: 'rm', decision: 'allow' }],
      projectRules: [{ tool: 'Bash', matcher: 'rm', decision: 'deny' }],
    });
    expect(e.check({ tool: 'Bash', matcher: 'rm', summary: 'rm a.txt' })).toBe('deny');
  });

  it('session-remembered rules win over all', () => {
    const e = new PermissionEngine({
      projectRules: [{ tool: 'Edit', matcher: '/x/y.ts', decision: 'deny' }],
    });
    e.remember({ tool: 'Edit', matcher: '/x/y.ts', summary: '/x/y.ts' }, 'allow', 'session');
    expect(e.check({ tool: 'Edit', matcher: '/x/y.ts', summary: '/x/y.ts' })).toBe('allow');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/core/test/permission/engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/core/src/permission/types.ts`**

```ts
export type PermissionDecision = 'allow' | 'deny' | 'ask' | 'forbidden';

export interface PermissionRule {
  tool: string;
  matcher: string;
  decision: 'allow' | 'deny' | 'ask';
}
```

- [ ] **Step 4: Implement `packages/core/src/permission/blacklist.ts`**

```ts
const PATTERNS: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/\s*\*?\s*$/,
  /\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+\/\s*\*?\s*$/,
  /^\s*sudo\b/,
  /:\(\)\s*\{[^}]*\|:&[^}]*\}\s*;\s*:/,
];

export function isDangerous(cmd: string): boolean {
  return PATTERNS.some(p => p.test(cmd));
}
```

- [ ] **Step 5: Implement `packages/core/src/permission/engine.ts`**

```ts
import type { PermissionRule, PermissionDecision } from './types.js';
import type { PermissionRequest } from '../tools/types.js';
import { isDangerous } from './blacklist.js';

export { isDangerous };

export type PermissionScope = 'session' | 'project' | 'global';

export interface PermissionEngineOpts {
  projectRules?: PermissionRule[];
  globalRules?: PermissionRule[];
}

export class PermissionEngine {
  private readonly project: PermissionRule[];
  private readonly global: PermissionRule[];
  private readonly session: PermissionRule[] = [];

  constructor(opts: PermissionEngineOpts = {}) {
    this.project = opts.projectRules ?? [];
    this.global = opts.globalRules ?? [];
  }

  check(req: PermissionRequest): PermissionDecision {
    if (req.tool === 'Bash' && isDangerous(req.summary)) return 'forbidden';
    for (const layer of [this.session, this.project, this.global]) {
      const hit = layer.find(r => r.tool === req.tool && r.matcher === req.matcher);
      if (hit) return hit.decision;
    }
    return 'ask';
  }

  remember(req: PermissionRequest, decision: 'allow' | 'deny', scope: PermissionScope): void {
    if (scope !== 'session') throw new Error('Only session-scope remember is supported in v0.1');
    this.session.push({ tool: req.tool, matcher: req.matcher, decision });
  }
}
```

- [ ] **Step 6: Re-export**

Append to `packages/core/src/index.ts`:

```ts
export * from './permission/types.js';
export * from './permission/engine.js';
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run packages/core/test/permission/engine.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add permission engine with 3-layer priority, session memory, blacklist"
```

---

## Task 14: Session (memory)

**Files:**
- Create: `packages/core/src/session/types.ts`
- Create: `packages/core/src/session/memory.ts`
- Create: `packages/core/test/session/memory.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Message`, `Usage`
- Produces:
  - `Session`: `{ id: string; messages: Message[]; readFiles: Set<string>; usage: Usage; startedAt: Date }`
  - `SessionStore`: `{ create(): Session; get(id: string): Session | undefined }`
  - `MemorySessionStore implements SessionStore`

- [ ] **Step 1: Failing test — `packages/core/test/session/memory.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MemorySessionStore } from '../../src/session/memory.js';

describe('MemorySessionStore', () => {
  it('creates a session with unique id', () => {
    const store = new MemorySessionStore();
    const a = store.create();
    const b = store.create();
    expect(a.id).not.toBe(b.id);
    expect(a.messages).toEqual([]);
    expect(a.readFiles).toBeInstanceOf(Set);
    expect(a.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it('retrieves session by id', () => {
    const store = new MemorySessionStore();
    const a = store.create();
    expect(store.get(a.id)).toBe(a);
    expect(store.get('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/core/test/session/memory.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/core/src/session/types.ts`**

```ts
import type { Message, Usage } from '../types.js';

export interface Session {
  id: string;
  messages: Message[];
  readFiles: Set<string>;
  usage: Usage;
  startedAt: Date;
}

export interface SessionStore {
  create(): Session;
  get(id: string): Session | undefined;
}
```

- [ ] **Step 4: Implement `packages/core/src/session/memory.ts`**

```ts
import { randomBytes } from 'node:crypto';
import type { Session, SessionStore } from './types.js';

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  create(): Session {
    const id = randomBytes(8).toString('hex');
    const s: Session = {
      id,
      messages: [],
      readFiles: new Set<string>(),
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      startedAt: new Date(),
    };
    this.sessions.set(id, s);
    return s;
  }

  get(id: string): Session | undefined { return this.sessions.get(id); }
}
```

- [ ] **Step 5: Re-export**

Append to `packages/core/src/index.ts`:

```ts
export * from './session/types.js';
export * from './session/memory.js';
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run packages/core/test/session/memory.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add in-memory Session and SessionStore"
```

---

## Task 15: Agent loop

**Files:**
- Create: `packages/core/src/agent/events.ts`
- Create: `packages/core/src/agent/loop.ts`
- Create: `packages/core/test/agent/loop.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Provider`, `ToolRegistry`, `PermissionEngine`, `Session`, `Logger`, `AgentEvent`
- Produces:
  - `runAgentLoop(opts)` async generator yielding `AgentEvent`s
  - `opts: { provider, registry, permission, session, userInput, model, maxSteps, signal, logger, askPermission }`
  - `askPermission(req): Promise<{ decision: 'allow' | 'deny'; remember: boolean }>` — callback supplied by caller (CLI implements terminal prompt; tests pass a stub)
  - Behavior:
    1. Append user message
    2. Loop until `done`:
       - Call `provider.stream(...)` and re-emit `text_delta` / `thinking_delta` to caller; accumulate assistant content and tool_calls
       - On `finish: 'stop'` → emit `done: 'natural'` and exit
       - On `finish: 'tool_calls'` → append assistant message with tool_calls; for each tool_call **serially**:
         - Permission check → if `ask`, call `askPermission`; if user picks remember, call `engine.remember`
         - On `deny` / `forbidden` → push tool result with error `permission_denied` and emit `tool_call_result`, continue
         - Validate input against tool's zod schema; on failure push tool result `invalid_args`
         - Execute tool with shared `ToolContext` (cwd, signal, logger, session.readFiles)
         - Push `{ role: 'tool', tool_call_id, name, content: JSON.stringify(result.output ?? { error: result.error }) }`
         - Emit `tool_call_result`
       - Emit `step_done`
    3. If step count hits `maxSteps` → emit `done: 'max_steps'` and exit
    4. On abort → emit `done: 'abort'` and exit
    5. On unrecoverable error → emit `error` then `done: 'fatal'`
  - R1 quirk: if `model.startsWith('deepseek-reasoner')`, do NOT include `tools` in request and warn once; on tool_calls finish, treat as `'stop'`

- [ ] **Step 1: Failing test — `packages/core/test/agent/loop.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runAgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry, PermissionEngine, MemorySessionStore, NullLogger } from '../../src/index.js';
import type { Provider, ChatRequest } from '../../src/provider/types.js';
import type { ProviderEvent, AgentEvent } from '../../src/types.js';

class FakeProvider implements Provider {
  constructor(private scripts: ProviderEvent[][]) {}
  async *stream(_req: ChatRequest): AsyncIterable<ProviderEvent> {
    const next = this.scripts.shift();
    if (!next) throw new Error('no more scripted responses');
    for (const ev of next) yield ev;
  }
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const echoTool = {
  name: 'Echo',
  description: 'echoes',
  inputSchema: z.object({ msg: z.string() }),
  needsPermission: () => null,
  async execute(input: { msg: string }) {
    return { ok: true as const, output: { echoed: input.msg } };
  },
};

describe('runAgentLoop', () => {
  it('returns natural done when model emits only text', async () => {
    const provider = new FakeProvider([[
      { type: 'text_delta', text: 'hi' },
      { type: 'finish', reason: 'stop' },
    ]]);
    const events = await collect(runAgentLoop({
      provider,
      registry: new ToolRegistry(),
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'hello',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.find(e => e.type === 'text_delta')).toBeDefined();
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });

  it('executes a tool then continues to natural done', async () => {
    const provider = new FakeProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Echo', args: { msg: 'hi' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const events = await collect(runAgentLoop({
      provider,
      registry,
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'use Echo',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.find(e => e.type === 'tool_call_start')).toBeDefined();
    expect(events.find(e => e.type === 'tool_call_result' && (e as any).result.ok)).toBeDefined();
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });

  it('stops at max_steps', async () => {
    // every script returns tool_calls → loop never ends naturally
    const scripts: ProviderEvent[][] = Array.from({ length: 10 }, () => [
      { type: 'tool_call_done', id: 'c1', name: 'Echo', args: { msg: 'x' } },
      { type: 'finish', reason: 'tool_calls' },
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const events = await collect(runAgentLoop({
      provider: new FakeProvider(scripts),
      registry,
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'spam',
      model: 'deepseek-chat',
      maxSteps: 3,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'max_steps' });
  });

  it('feeds permission_denied back as tool result', async () => {
    const provider = new FakeProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Bash', args: { command: 'rm -rf /' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'understood, will not.' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);
    const registry = new ToolRegistry();
    registry.register({
      name: 'Bash',
      description: 'shell',
      inputSchema: z.object({ command: z.string() }),
      needsPermission: (input) => ({ tool: 'Bash', matcher: 'rm', summary: input.command }),
      async execute() { throw new Error('should not execute'); },
    });
    const events = await collect(runAgentLoop({
      provider,
      registry,
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'delete root',
      model: 'deepseek-chat',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    const result = events.find(e => e.type === 'tool_call_result') as any;
    expect(result.result.ok).toBe(false);
    expect(result.result.error).toBe('permission_denied');
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
  });

  it('R1 model omits tools and warns', async () => {
    let capturedRequest: ChatRequest | null = null;
    const provider: Provider = {
      async *stream(req) { capturedRequest = req; yield { type: 'text_delta', text: 'hi' }; yield { type: 'finish', reason: 'stop' }; },
    };
    const registry = new ToolRegistry();
    registry.register(echoTool);
    await collect(runAgentLoop({
      provider,
      registry,
      permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'hi',
      model: 'deepseek-reasoner',
      maxSteps: 5,
      signal: new AbortController().signal,
      logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(capturedRequest!.tools).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/core/test/agent/loop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/agent/events.ts`**

```ts
import type { AgentEvent } from '../types.js';
export type { AgentEvent };
```

- [ ] **Step 4: Implement `packages/core/src/agent/loop.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Provider } from '../provider/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionEngine } from '../permission/engine.js';
import type { Session } from '../session/types.js';
import type { Logger } from '../logger.js';
import type {
  AgentEvent, Message, ProviderEvent, ToolCall, ToolResultEnvelope,
} from '../types.js';
import type { PermissionRequest } from '../tools/types.js';

export interface AskPermissionResult { decision: 'allow' | 'deny'; remember: boolean }

export interface RunAgentLoopOpts {
  provider: Provider;
  registry: ToolRegistry;
  permission: PermissionEngine;
  session: Session;
  userInput: string;
  model: string;
  maxSteps: number;
  signal: AbortSignal;
  logger: Logger;
  askPermission: (req: PermissionRequest) => Promise<AskPermissionResult>;
}

export async function* runAgentLoop(opts: RunAgentLoopOpts): AsyncIterable<AgentEvent> {
  const { provider, registry, permission, session, userInput, model, maxSteps, signal, logger, askPermission } = opts;
  const isR1 = model.startsWith('deepseek-reasoner');

  session.messages.push({ role: 'user', content: userInput });
  let step = 0;

  while (step < maxSteps) {
    if (signal.aborted) { yield { type: 'done', reason: 'abort' }; return; }
    step++;
    const tools = isR1 ? undefined : registry.toSchemas();
    if (isR1 && step === 1) logger.warn('R1 模式：已自动停用工具调用');

    let assistantContent = '';
    const pendingCalls = new Map<string, { name: string; args: unknown }>();
    let finishReason: 'stop' | 'tool_calls' | 'length' | null = null;

    try {
      for await (const ev of provider.stream({ model, messages: session.messages, tools }, signal)) {
        switch (ev.type) {
          case 'text_delta':
            assistantContent += ev.text;
            yield { type: 'text_delta', text: ev.text };
            break;
          case 'thinking_delta':
            yield { type: 'thinking_delta', text: ev.text };
            break;
          case 'tool_call_done':
            pendingCalls.set(ev.id, { name: ev.name, args: ev.args });
            break;
          case 'usage':
            session.usage.prompt_tokens += ev.usage.prompt_tokens;
            session.usage.completion_tokens += ev.usage.completion_tokens;
            session.usage.total_tokens += ev.usage.total_tokens;
            break;
          case 'finish':
            finishReason = ev.reason;
            break;
        }
      }
    } catch (e: any) {
      if (signal.aborted) { yield { type: 'done', reason: 'abort' }; return; }
      yield { type: 'error', error: { code: e.code ?? 'PROVIDER_ERROR', userMessage: e.userMessage ?? e.message } };
      yield { type: 'done', reason: 'fatal' };
      return;
    }

    if (isR1 || finishReason === 'stop' || pendingCalls.size === 0) {
      if (assistantContent) session.messages.push({ role: 'assistant', content: assistantContent });
      yield { type: 'step_done', step };
      yield { type: 'done', reason: 'natural' };
      return;
    }

    if (finishReason === 'length') {
      yield { type: 'error', error: { code: 'CONTEXT_EXHAUSTED', userMessage: '上下文已满，请开新会话' } };
      yield { type: 'done', reason: 'fatal' };
      return;
    }

    const toolCalls: ToolCall[] = [];
    for (const [id, c] of pendingCalls) {
      toolCalls.push({ id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } });
    }
    session.messages.push({ role: 'assistant', content: assistantContent || null, tool_calls: toolCalls });

    for (const [id, c] of pendingCalls) {
      const tool = registry.get(c.name);
      if (!tool) {
        const env: ToolResultEnvelope = { ok: false, error: 'unknown_tool' };
        session.messages.push({ role: 'tool', content: JSON.stringify(env), tool_call_id: id, name: c.name });
        yield { type: 'tool_call_result', id, result: env };
        continue;
      }
      const parsed = tool.inputSchema.safeParse(c.args);
      if (!parsed.success) {
        const env: ToolResultEnvelope = { ok: false, error: `invalid_args: ${parsed.error.message}` };
        session.messages.push({ role: 'tool', content: JSON.stringify(env), tool_call_id: id, name: c.name });
        yield { type: 'tool_call_result', id, result: env };
        continue;
      }
      yield { type: 'tool_call_start', id, name: c.name, input: parsed.data };
      const req = tool.needsPermission(parsed.data);
      if (req) {
        let decision = permission.check(req);
        if (decision === 'ask') {
          const res = await askPermission(req);
          decision = res.decision;
          if (res.remember) permission.remember(req, res.decision, 'session');
        }
        if (decision === 'deny' || decision === 'forbidden') {
          const env: ToolResultEnvelope = { ok: false, error: 'permission_denied' };
          session.messages.push({ role: 'tool', content: JSON.stringify(env), tool_call_id: id, name: c.name });
          yield { type: 'tool_call_result', id, result: env };
          continue;
        }
      }
      let result: ToolResultEnvelope;
      try {
        const r = await tool.execute(parsed.data, { cwd: process.cwd(), signal, logger, session: { readFiles: session.readFiles } });
        result = r.ok ? { ok: true, output: r.output, display: r.display } : { ok: false, error: r.error };
      } catch (e: any) {
        result = { ok: false, error: e.message ?? 'execute_failed' };
      }
      session.messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: id, name: c.name });
      yield { type: 'tool_call_result', id, result };
    }

    yield { type: 'step_done', step };
  }

  yield { type: 'done', reason: 'max_steps' };
}
```

- [ ] **Step 5: Re-export**

Append to `packages/core/src/index.ts`:

```ts
export * from './agent/loop.js';
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run packages/core/test/agent/loop.test.ts`
Expected: all 5 PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add agent loop with serial tool exec, permissions, R1 fallback"
```

---

## Task 16: CLI render layer

**Files:**
- Create: `packages/cli/src/render/format.ts`
- Create: `packages/cli/src/render/stream.ts`
- Create: `packages/cli/test/render/format.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `picocolors`
- Produces:
  - `formatToolCallStart(name, input): string` — one-line header
  - `formatToolResult(env): string` — short success/error indicator + optional display preview
  - `renderAgentStream(events: AsyncIterable<AgentEvent>, out: NodeJS.WritableStream): Promise<{ exitCode: number }>`
    - Streams text deltas inline; thinking deltas in dim gray prefixed with `[思考]`; tool calls as `▶ Tool(args summary)` then `✓` / `✗` indicator
    - Returns 0 on `done.natural`, 1 on `done.fatal` / `done.max_steps`, 130 on `done.abort`

- [ ] **Step 1: Failing test — `packages/cli/test/render/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { formatToolCallStart, formatToolResult } from '../../src/render/format.js';

describe('format', () => {
  it('formatToolCallStart shows short args', () => {
    const s = formatToolCallStart('Read', { file_path: '/tmp/a.ts' });
    expect(s).toContain('Read');
    expect(s).toContain('/tmp/a.ts');
  });

  it('formatToolResult shows OK for success', () => {
    const s = formatToolResult({ ok: true, output: { x: 1 } });
    expect(s).toMatch(/✓|OK/);
  });

  it('formatToolResult shows error code', () => {
    const s = formatToolResult({ ok: false, error: 'permission_denied' });
    expect(s).toContain('permission_denied');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/cli/test`
Expected: FAIL.

(Note: the cli package needs a test config — it inherits from root `vitest.config.ts` since `include` covers `packages/*/test/**/*.test.ts`. Also `packages/cli/package.json` needs vitest devDep? — no, root provides it via workspace.)

- [ ] **Step 3: Implement `packages/cli/src/render/format.ts`**

```ts
import pc from 'picocolors';
import type { ToolResultEnvelope } from '@deepseek-code/core';

function shortArgs(input: unknown): string {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.file_path === 'string') return obj.file_path;
    if (typeof obj.command === 'string') return obj.command.slice(0, 80);
    if (typeof obj.pattern === 'string') return `/${obj.pattern}/`;
  }
  return JSON.stringify(input).slice(0, 80);
}

export function formatToolCallStart(name: string, input: unknown): string {
  return pc.cyan(`▶ ${name}(${shortArgs(input)})`);
}

export function formatToolResult(env: ToolResultEnvelope): string {
  if (env.ok) return pc.green('  ✓ OK');
  return pc.red(`  ✗ ${env.error}`);
}
```

- [ ] **Step 4: Implement `packages/cli/src/render/stream.ts`**

```ts
import pc from 'picocolors';
import type { AgentEvent } from '@deepseek-code/core';
import { formatToolCallStart, formatToolResult } from './format.js';

export async function renderAgentStream(
  events: AsyncIterable<AgentEvent>,
  out: NodeJS.WritableStream,
): Promise<{ exitCode: number }> {
  let exitCode = 0;
  let lastWasText = false;
  for await (const ev of events) {
    if (ev.type === 'text_delta') {
      out.write(ev.text);
      lastWasText = true;
      continue;
    }
    if (lastWasText) { out.write('\n'); lastWasText = false; }
    switch (ev.type) {
      case 'thinking_delta':
        out.write(pc.gray(`[思考] ${ev.text}\n`));
        break;
      case 'tool_call_start':
        out.write(formatToolCallStart(ev.name, ev.input) + '\n');
        break;
      case 'tool_call_result':
        out.write(formatToolResult(ev.result) + '\n');
        break;
      case 'error':
        out.write(pc.red(`! ${ev.error.code}: ${ev.error.userMessage}\n`));
        break;
      case 'done':
        if (ev.reason === 'fatal' || ev.reason === 'max_steps') exitCode = 1;
        if (ev.reason === 'abort') exitCode = 130;
        break;
    }
  }
  return { exitCode };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/cli/test/render/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): add streaming AgentEvent renderer and format helpers"
```

---

## Task 17: CLI permission prompt + login

**Files:**
- Create: `packages/cli/src/permission-prompt.ts`
- Create: `packages/cli/src/login.ts`
- Create: `packages/cli/test/permission-prompt.test.ts`

**Interfaces:**
- Consumes: `PermissionRequest`, `writeConfig` from core
- Produces:
  - `makeAskPermission(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream)` returns the `askPermission` callback the agent loop expects
  - Interaction: prints
    ```
    [?] <Tool> wants: <summary>
        [a] allow once  [A] allow for session  [d] deny once  [D] deny for session
    ```
    reads one char; maps to decision + remember
  - `runLogin(stdin, stdout, opts?: { homeDir? })`: prompt for API key (no echo via `readline` raw mode), then `writeConfig({ apiKey, ...DEFAULTS })`

- [ ] **Step 1: Failing test — `packages/cli/test/permission-prompt.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { makeAskPermission } from '../src/permission-prompt.js';

function streams(input: string) {
  const stdin = Readable.from([input]);
  const chunks: string[] = [];
  const stdout = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  return { stdin, stdout, chunks };
}

describe('makeAskPermission', () => {
  it('returns allow once for "a"', async () => {
    const { stdin, stdout, chunks } = streams('a\n');
    const ask = makeAskPermission(stdin as any, stdout as any);
    const r = await ask({ tool: 'Bash', matcher: 'git status', summary: 'git status' });
    expect(r).toEqual({ decision: 'allow', remember: false });
    expect(chunks.join('')).toContain('git status');
  });

  it('returns allow + remember for "A"', async () => {
    const { stdin, stdout } = streams('A\n');
    const ask = makeAskPermission(stdin as any, stdout as any);
    const r = await ask({ tool: 'Bash', matcher: 'ls', summary: 'ls' });
    expect(r).toEqual({ decision: 'allow', remember: true });
  });

  it('returns deny once for "d" (and for any other char)', async () => {
    const { stdin, stdout } = streams('d\n');
    const ask = makeAskPermission(stdin as any, stdout as any);
    const r = await ask({ tool: 'Bash', matcher: 'rm', summary: 'rm -f x' });
    expect(r).toEqual({ decision: 'deny', remember: false });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run packages/cli/test/permission-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/cli/src/permission-prompt.ts`**

```ts
import { createInterface } from 'node:readline';
import pc from 'picocolors';
import type { PermissionRequest } from '@deepseek-code/core';

export type AskPermissionFn = (req: PermissionRequest) => Promise<{ decision: 'allow' | 'deny'; remember: boolean }>;

export function makeAskPermission(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): AskPermissionFn {
  return async (req) => {
    stdout.write(pc.yellow(`[?] ${req.tool} wants: ${req.summary}\n`));
    stdout.write(`    [a] allow once  [A] allow for session  [d] deny once  [D] deny for session\n`);
    const rl = createInterface({ input: stdin as NodeJS.ReadableStream, output: stdout, terminal: false });
    const answer: string = await new Promise(res => rl.question('> ', a => { rl.close(); res(a); }));
    const c = answer.trim()[0] ?? 'd';
    switch (c) {
      case 'a': return { decision: 'allow', remember: false };
      case 'A': return { decision: 'allow', remember: true };
      case 'd': return { decision: 'deny', remember: false };
      case 'D': return { decision: 'deny', remember: true };
      default:  return { decision: 'deny', remember: false };
    }
  };
}
```

- [ ] **Step 4: Implement `packages/cli/src/login.ts`**

```ts
import { createInterface } from 'node:readline';
import { DEFAULT_CONFIG, writeConfig } from '@deepseek-code/core';

export interface RunLoginOpts { homeDir?: string }

export async function runLogin(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, opts: RunLoginOpts = {}): Promise<void> {
  const rl = createInterface({ input: stdin as NodeJS.ReadableStream, output: stdout, terminal: false });
  const apiKey: string = await new Promise(res => rl.question('请粘贴 DeepSeek API key（sk-...）: ', a => { rl.close(); res(a.trim()); }));
  if (!apiKey) {
    stdout.write('未输入 API key，取消。\n');
    return;
  }
  writeConfig({ apiKey, model: DEFAULT_CONFIG.model, baseUrl: DEFAULT_CONFIG.baseUrl, bashTimeoutMs: DEFAULT_CONFIG.bashTimeoutMs, maxSteps: DEFAULT_CONFIG.maxSteps }, opts);
  stdout.write('已写入 ~/.deepseek-code/config.json\n');
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/cli/test/permission-prompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): add permission prompt and login flow"
```

---

## Task 18: CLI main + REPL + bin

**Files:**
- Create: `packages/cli/src/repl.ts`
- Create: `packages/cli/src/main.ts` (replaces placeholder)
- Create: `packages/cli/bin/deepseek-code`

**Interfaces:**
- Consumes: everything
- Produces:
  - `main(argv)` async entry returning exit code
  - `commander` parses: `[prompt]` positional, `--model <m>`, `--debug`, `--cwd <p>`, subcommand `login`
  - When called with prompt → run one turn → exit
  - When called without prompt → enter REPL: prompt `> `, each line runs one turn, Ctrl+C cancels current turn, Ctrl+D exits
  - On debug → attach `JsonlLogger` to `~/.deepseek-code/logs/session-<id>.jsonl`

- [ ] **Step 1: Implement `packages/cli/src/repl.ts`**

```ts
import { createInterface } from 'node:readline';
import type { Session } from '@deepseek-code/core';

export interface ReplDeps {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  runTurn: (input: string, session: Session, signal: AbortSignal) => Promise<number>;
  session: Session;
}

export async function startRepl(deps: ReplDeps): Promise<number> {
  const rl = createInterface({ input: deps.stdin as NodeJS.ReadableStream, output: deps.stdout, terminal: true, prompt: '> ' });
  let lastExit = 0;
  let activeAbort: AbortController | null = null;
  rl.on('SIGINT', () => { if (activeAbort) activeAbort.abort(); else rl.close(); });
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }
    activeAbort = new AbortController();
    lastExit = await deps.runTurn(input, deps.session, activeAbort.signal);
    activeAbort = null;
    rl.prompt();
  }
  return lastExit;
}
```

- [ ] **Step 2: Implement `packages/cli/src/main.ts`**

```ts
import { Command } from 'commander';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig, ConsoleLogger, JsonlLogger, NullLogger,
  ToolRegistry, PermissionEngine, MemorySessionStore,
  runAgentLoop, DeepseekProvider, DeepseekCodeError,
} from '@deepseek-code/core';
import { readTool, grepTool, bashTool, editTool, writeTool } from '@deepseek-code/tools';
import { renderAgentStream } from './render/stream.js';
import { makeAskPermission } from './permission-prompt.js';
import { runLogin } from './login.js';
import { startRepl } from './repl.js';

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('deepseek-code')
    .version('0.1.0')
    .argument('[prompt...]', '一次性任务输入')
    .option('--model <name>', 'DeepSeek 模型', undefined)
    .option('--debug', '写入 JSONL 日志', false)
    .option('--cwd <path>', '工作目录', process.cwd());

  program
    .command('login')
    .description('设置 DeepSeek API key')
    .action(async () => { await runLogin(process.stdin, process.stdout); process.exit(0); });

  program.parse(argv);
  const opts = program.opts<{ model?: string; debug: boolean; cwd: string }>();
  const args = program.args;

  const cwd = resolve(opts.cwd);
  process.chdir(cwd);

  let config;
  try { config = loadConfig(); }
  catch (e) {
    if (e instanceof DeepseekCodeError) { process.stderr.write(e.userMessage + '\n'); return 1; }
    throw e;
  }
  const model = opts.model ?? config.model;

  const registry = new ToolRegistry();
  registry.register(readTool);
  registry.register(grepTool);
  registry.register(bashTool);
  registry.register(editTool);
  registry.register(writeTool);
  const permission = new PermissionEngine();
  const sessionStore = new MemorySessionStore();
  const session = sessionStore.create();
  const logger = opts.debug
    ? new JsonlLogger(join(homedir(), '.deepseek-code', 'logs', `session-${session.id}.jsonl`))
    : new NullLogger();
  const provider = new DeepseekProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const ask = makeAskPermission(process.stdin, process.stdout);

  const runTurn = async (input: string, sess = session, signal?: AbortSignal): Promise<number> => {
    const ctl = signal ? null : new AbortController();
    const sig = signal ?? ctl!.signal;
    const events = runAgentLoop({
      provider, registry, permission, session: sess,
      userInput: input, model, maxSteps: config.maxSteps,
      signal: sig, logger, askPermission: ask,
    });
    const { exitCode } = await renderAgentStream(events, process.stdout);
    process.stdout.write('\n');
    return exitCode;
  };

  if (args.length === 0) {
    return startRepl({ stdin: process.stdin, stdout: process.stdout, session, runTurn });
  }
  const promptText = args.join(' ');
  return runTurn(promptText);
}

main(process.argv).then((code) => process.exit(code));
```

- [ ] **Step 3: Create `packages/cli/bin/deepseek-code`**

```bash
#!/usr/bin/env node
import('../dist/main.js');
```

Then `chmod +x packages/cli/bin/deepseek-code`.

- [ ] **Step 4: Build everything**

Run:
```bash
pnpm -r build
pnpm -r typecheck
```
Expected: green.

- [ ] **Step 5: Verify `--help` works**

Run: `node packages/cli/dist/main.js --help`
Expected: commander help text appears (program exits 0).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): add commander entry, REPL with SIGINT cancel, bin launcher"
```

---

## Task 19: Integration scenarios + CI + README

**Files:**
- Create: `packages/core/test/integration/scenarios.test.ts`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: everything
- Produces:
  - 10 scripted scenarios exercising the agent loop end-to-end with a `FakeProvider` and the real 5 tools
  - GitHub Actions workflow installing pnpm, ripgrep, running typecheck + tests + build
  - User-facing README in Chinese covering install, login, usage, configuration

- [ ] **Step 1: Failing test — `packages/core/test/integration/scenarios.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ToolRegistry, PermissionEngine, MemorySessionStore, NullLogger,
  runAgentLoop,
} from '../../src/index.js';
import { readTool, editTool, bashTool } from '@deepseek-code/tools';
import type { Provider, ChatRequest } from '../../src/provider/types.js';
import type { ProviderEvent, AgentEvent } from '../../src/types.js';

class ScriptedProvider implements Provider {
  constructor(private scripts: ProviderEvent[][]) {}
  async *stream(_req: ChatRequest): AsyncIterable<ProviderEvent> {
    const next = this.scripts.shift();
    if (!next) throw new Error('exhausted scripts');
    for (const e of next) yield e;
  }
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function makeRegistry() {
  const r = new ToolRegistry();
  r.register(readTool); r.register(editTool); r.register(bashTool);
  return r;
}

describe('integration scenarios', () => {
  it('reads then edits a file successfully', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's1-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'helo world\n');
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Read', args: { file_path: f } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'tool_call_done', id: 'c2', name: 'Edit', args: { file_path: f, old_string: 'helo', new_string: 'hello' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);
    const session = new MemorySessionStore().create();
    const events = await collect(runAgentLoop({
      provider, registry: makeRegistry(), permission: new PermissionEngine(),
      session, userInput: 'fix typo', model: 'deepseek-chat', maxSteps: 10,
      signal: new AbortController().signal, logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
    expect(readFileSync(f, 'utf8')).toBe('hello world\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('Edit before Read fails with not_read_in_session, model can recover', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's2-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'x');
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Edit', args: { file_path: f, old_string: 'x', new_string: 'y' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'tool_call_done', id: 'c2', name: 'Read', args: { file_path: f } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'tool_call_done', id: 'c3', name: 'Edit', args: { file_path: f, old_string: 'x', new_string: 'y' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'ok' }, { type: 'finish', reason: 'stop' }],
    ]);
    const session = new MemorySessionStore().create();
    const events = await collect(runAgentLoop({
      provider, registry: makeRegistry(), permission: new PermissionEngine(),
      session, userInput: 'edit', model: 'deepseek-chat', maxSteps: 10,
      signal: new AbortController().signal, logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'natural' });
    expect(readFileSync(f, 'utf8')).toBe('y');
    rmSync(dir, { recursive: true, force: true });
  });

  it('Bash forbidden command never executes', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Bash', args: { command: 'rm -rf /' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'will not' }, { type: 'finish', reason: 'stop' }],
    ]);
    const events = await collect(runAgentLoop({
      provider, registry: makeRegistry(), permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'nuke', model: 'deepseek-chat', maxSteps: 5,
      signal: new AbortController().signal, logger: new NullLogger(),
      askPermission: async () => ({ decision: 'allow', remember: false }),
    }));
    const res = events.find(e => e.type === 'tool_call_result') as any;
    expect(res.result.ok).toBe(false);
    expect(res.result.error).toBe('permission_denied');
  });

  it('Bash ask + allow for session: second call does not re-ask', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call_done', id: 'c1', name: 'Bash', args: { command: 'git status' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'tool_call_done', id: 'c2', name: 'Bash', args: { command: 'git status -s' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'ok' }, { type: 'finish', reason: 'stop' }],
    ]);
    let asks = 0;
    const events = await collect(runAgentLoop({
      provider, registry: makeRegistry(), permission: new PermissionEngine(),
      session: new MemorySessionStore().create(),
      userInput: 'check status', model: 'deepseek-chat', maxSteps: 5,
      signal: new AbortController().signal, logger: new NullLogger(),
      askPermission: async () => { asks++; return { decision: 'allow', remember: true }; },
    }));
    expect(asks).toBe(1);
    expect(events.filter(e => e.type === 'tool_call_result').every((e: any) => e.result.ok)).toBe(true);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `pnpm vitest run packages/core/test/integration/scenarios.test.ts`
Expected: all 4 PASS.

- [ ] **Step 3: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - name: Install ripgrep
        run: sudo apt-get update && sudo apt-get install -y ripgrep
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r build
      - run: pnpm test
      - name: CLI smoke
        run: node packages/cli/dist/main.js --version
```

- [ ] **Step 4: Create `README.md`**

```markdown
# deepseek-code

深度适配 DeepSeek 模型的命令行编码 Agent — TypeScript 实现，对标 Claude Code。

## 安装（开发版）

```bash
pnpm install
pnpm -r build
node packages/cli/bin/deepseek-code --version
```

## 首次登录

```bash
node packages/cli/bin/deepseek-code login
# 粘贴 DeepSeek API key（sk-...）即可
```

配置写入 `~/.deepseek-code/config.json`。

## 使用

单次任务：

```bash
deepseek-code "帮我把 src/foo.ts 里的 typo 修一下，跑下 vitest"
```

进入交互式 REPL：

```bash
deepseek-code
> 列出当前目录有哪些 TypeScript 文件
> 修一下 README 里的拼写错误
```

## 支持的工具（v0.1）

- **Read** — 读文件，cat -n 风格
- **Edit** — 唯一字符串替换
- **Write** — 整文件写入
- **Bash** — 执行 shell（带超时、权限询问）
- **Grep** — ripgrep 包装

## 权限模型

- `Read` / `Grep`：默认放行
- `Edit` / `Write`：按文件路径首次询问
- `Bash`：按命令"特征前缀"首次询问（`git status -s` → 记 `git status`）
- 黑名单（`rm -rf /` / `sudo` / fork bomb）：直接拒绝，无法放行

询问时按键：
- `a` 仅本次允许 / `A` 本会话允许
- `d` 仅本次拒绝 / `D` 本会话拒绝

## 选项

| flag | 说明 |
|---|---|
| `--model <name>` | 覆盖默认模型（如 `deepseek-reasoner`，会自动停用工具调用） |
| `--debug` | 写入 JSONL 日志到 `~/.deepseek-code/logs/` |
| `--cwd <path>` | 切换工作目录 |

## 开发

```bash
pnpm test              # 全部测试 + 覆盖率
pnpm test:watch        # watch 模式
pnpm -r typecheck      # 类型检查
pnpm -r build          # 编译
```

需要本机已安装 `ripgrep`（macOS：`brew install ripgrep`）。

## 路线图

- **v0.1**（当前）— 单 agent loop + 5 工具 + 三态权限
- **v0.2** — Ink TUI + 持久 session + 历史压缩 + Memory(DEEPSEEK.md) + Plan mode
- **v0.3+** — Sub-agent + Skills + Hooks + MCP
```

- [ ] **Step 5: Full test + build verification**

Run:
```bash
pnpm install
pnpm -r typecheck
pnpm -r build
pnpm test
```
Expected: all green; coverage ≥ 80% on `core` + `tools`.

- [ ] **Step 6: CLI smoke**

Run: `node packages/cli/bin/deepseek-code --version`
Expected: `0.1.0`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: integration scenarios, CI workflow, and README

Closes Phase 1 v0.1: full read→edit→bash loop verified by integration
tests, 80% coverage gate enforced, CI green on Ubuntu with ripgrep."
```

---

## Self-Review Result

Performed inline check against the spec:

**Spec coverage:**
- §0 vision / §1 goals — Tasks 1 + 19 (README mirrors three-phase roadmap)
- §2 design decisions — Task 1 (monorepo, deps, TS config)
- §3 repo structure — Task 1 (locked in scaffold)
- §4 agent loop — Task 15
- §5 DeepSeek provider — Tasks 5-6
- §6 tool system — Tasks 7-12
- §7 permission engine — Task 13
- §8 session / config / CLI — Tasks 4, 14, 17, 18
- §9 error handling — DeepseekCodeError in Task 2; per-layer behavior across Tasks 6, 15, 18
- §10 testing strategy — Tasks 2-19 all use TDD; Task 19 covers integration scenarios; vitest config in Task 1 enforces 80% coverage
- §11 completion criteria — verified in Task 19 step 5/6
- §12 phase 2/3 hooks — preserved via `SessionStore` interface, event-driven loop, dynamic `ToolRegistry`, injected `Logger`

**Placeholder scan:** All "TBD/TODO/etc" patterns absent. Every step has concrete code or commands.

**Type consistency check:**
- `ToolContext` extended in Task 11 step 1 to include `session: ToolSession`; Tasks 8 (Read), 9 (Grep), 10 (Bash) test helpers updated in Task 11 step 2 to pass `session`
- `ToolResultEnvelope` defined in Task 2 matches usage in Task 15 (loop) and Task 19 (integration)
- `PermissionRequest` defined in Task 7 (`tools/types.ts`) used by Tasks 11/12/13/17 consistently
- `AskPermissionFn` signature `(req) => Promise<{ decision, remember }>` matches between Task 15 (loop), Task 17 (prompt), Task 18 (main)
- `Provider.stream(req, signal)` defined Task 5, used Task 6 (DeepseekProvider), Task 15 (loop), Task 19 (ScriptedProvider)

No gaps found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-30-deepseek-code-phase1.md`.
