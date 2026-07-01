/**
 * @file Login 流程
 * 自动打开浏览器到 DeepSeek API key 管理页，用户复制 key 后粘贴到终端
 */
import { createInterface } from 'node:readline';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { DEFAULT_CONFIG, writeConfig } from '@deepseek-code/core';

/** DeepSeek 平台 API key 管理页地址 */
const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys';

/** 跨平台打开浏览器 */
function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open'
    : platform() === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} ${url}`);
}

export interface RunLoginOpts { homeDir?: string }

export async function runLogin(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, opts: RunLoginOpts = {}): Promise<void> {
  stdout.write('\n正在打开 DeepSeek 平台...\n');
  stdout.write(`如果浏览器未自动打开，请手动访问：${DEEPSEEK_API_KEYS_URL}\n`);
  stdout.write('请在该页面创建或复制你的 API key\n\n');

  // 尝试打开浏览器
  openBrowser(DEEPSEEK_API_KEYS_URL);

  const rl = createInterface({ input: stdin as NodeJS.ReadableStream, output: stdout, terminal: false });
  const apiKey: string = await new Promise(res => rl.question('请粘贴 API key（sk-...）: ', a => { rl.close(); res(a.trim()); }));
  if (!apiKey) {
    stdout.write('未输入 API key，取消。\n');
    return;
  }
  if (!apiKey.startsWith('sk-')) {
    stdout.write('⚠️  API key 格式可能不正确（通常以 sk- 开头），已保存。\n');
  }
  writeConfig({ apiKey, model: DEFAULT_CONFIG.model, baseUrl: DEFAULT_CONFIG.baseUrl, bashTimeoutMs: DEFAULT_CONFIG.bashTimeoutMs, maxSteps: DEFAULT_CONFIG.maxSteps }, opts);
  stdout.write('✅ 已保存到 ~/.deepseek-code/config.json\n');
}
