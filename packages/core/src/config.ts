/**
 * @file 配置加载器
 * 三级配置层叠（优先级从高到低）：
 * 1. 环境变量（DEEPSEEK_API_KEY / DEEPSEEK_MODEL 等）
 * 2. 项目级 <cwd>/.deepseek-code/config.json
 * 3. 用户级 ~/.deepseek-code/config.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { DeepseekCodeError } from './errors.js';

/** 阶段一默认配置值 */
export const DEFAULT_CONFIG = {
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1',
  bashTimeoutMs: 30000,
  maxSteps: 50,
} as const;

/** 配置 schema，用 zod 校验并提供默认值 */
const ConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default(DEFAULT_CONFIG.model),
  /** Compact 摘要使用的模型（默认同主模型，建议用 flash 省成本） */
  compactModel: z.string().optional(),
  /** Plan mode 执行阶段使用的模型（默认同主模型） */
  planExecuteModel: z.string().optional(),
  baseUrl: z.string().url().default(DEFAULT_CONFIG.baseUrl),
  bashTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.bashTimeoutMs),
  maxSteps: z.number().int().positive().default(DEFAULT_CONFIG.maxSteps),
  /** MCP Server 配置（可选） */
  mcpServers: z.record(z.object({
    type: z.enum(['stdio', 'sse']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
  })).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface LoadConfigOpts {
  homeDir?: string;
  /** 项目目录（用于读取项目级配置） */
  cwd?: string;
  /** 环境变量（默认 process.env） */
  env?: Record<string, string | undefined>;
}

/** 环境变量到配置字段的映射 */
const ENV_MAP: Record<string, string> = {
  DEEPSEEK_API_KEY: 'apiKey',
  DEEPSEEK_MODEL: 'model',
  DEEPSEEK_BASE_URL: 'baseUrl',
  DEEPSEEK_MAX_STEPS: 'maxSteps',
  DEEPSEEK_BASH_TIMEOUT: 'bashTimeoutMs',
};

function configPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.deepseek-code', 'config.json');
}

function projectConfigPath(cwd: string): string {
  return join(cwd, '.deepseek-code', 'config.json');
}

/**
 * 加载配置文件（三级层叠）
 * 合并顺序：用户级 → 项目级覆盖 → 环境变量覆盖 → zod 校验
 */
export function loadConfig(opts: LoadConfigOpts = {}): Config {
  const env = opts.env ?? process.env;

  // 1. 读取用户级配置（基准）
  const userPath = configPath(opts.homeDir);
  let merged: Record<string, unknown> = {};

  if (existsSync(userPath)) {
    try {
      merged = JSON.parse(readFileSync(userPath, 'utf8'));
    } catch (cause) {
      throw new DeepseekCodeError({
        code: 'CONFIG_INVALID',
        message: 'user config file is not valid JSON',
        userMessage: `用户配置文件格式错误：${userPath}`,
        cause,
      });
    }
  }

  // 2. 读取项目级配置（字段覆盖）
  if (opts.cwd) {
    const projPath = projectConfigPath(opts.cwd);
    if (existsSync(projPath)) {
      try {
        const projConfig = JSON.parse(readFileSync(projPath, 'utf8'));
        merged = { ...merged, ...projConfig };
      } catch {
        // 项目级配置解析失败时忽略
      }
    }
  }

  // 3. 环境变量覆盖
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const val = env[envKey];
    if (val !== undefined && val !== '') {
      // 数字类型字段需要转换
      if (configKey === 'maxSteps' || configKey === 'bashTimeoutMs') {
        const num = parseInt(val, 10);
        if (!isNaN(num)) merged[configKey] = num;
      } else {
        merged[configKey] = val;
      }
    }
  }

  // 4. 校验
  if (!merged.apiKey && !env.DEEPSEEK_API_KEY) {
    throw new DeepseekCodeError({
      code: 'CONFIG_MISSING_KEY',
      message: 'apiKey is required',
      userMessage: '未找到 API Key，请运行 `deepseek login` 或设置环境变量 DEEPSEEK_API_KEY',
    });
  }

  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new DeepseekCodeError({
      code: 'CONFIG_INVALID',
      message: parsed.error.message,
      userMessage: '配置字段不合法，请检查 config.json',
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** 写入配置文件（自动创建目录） */
export function writeConfig(cfg: Config, opts: LoadConfigOpts = {}): void {
  const p = configPath(opts.homeDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2));
}

/**
 * 获取配置字段来源信息（用于 /config 命令展示）
 */
export function getConfigSources(opts: LoadConfigOpts = {}): Record<string, string> {
  const env = opts.env ?? process.env;
  const sources: Record<string, string> = {};

  // 检查各字段来源
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    if (env[envKey]) {
      sources[configKey] = 'env';
    }
  }

  if (opts.cwd) {
    const projPath = projectConfigPath(opts.cwd);
    if (existsSync(projPath)) {
      try {
        const proj = JSON.parse(readFileSync(projPath, 'utf8'));
        for (const key of Object.keys(proj)) {
          if (!sources[key]) sources[key] = 'project';
        }
      } catch { /* ignore */ }
    }
  }

  const userPath = configPath(opts.homeDir);
  if (existsSync(userPath)) {
    try {
      const user = JSON.parse(readFileSync(userPath, 'utf8'));
      for (const key of Object.keys(user)) {
        if (!sources[key]) sources[key] = 'user';
      }
    } catch { /* ignore */ }
  }

  // 未指定来源的是 default
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (!sources[key]) sources[key] = 'default';
  }

  return sources;
}
