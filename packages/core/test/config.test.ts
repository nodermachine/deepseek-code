import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, writeConfig, getConfigSources, DEFAULT_CONFIG } from '../src/config.js';
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

  it('project config overrides user config', () => {
    const home = mkHome();
    const cwd = mkdtempSync(join(tmpdir(), 'dscproj-'));
    // user config
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code/config.json'), JSON.stringify({ apiKey: 'sk-user', model: 'deepseek-chat' }));
    // project config
    mkdirSync(join(cwd, '.deepseek-code'));
    writeFileSync(join(cwd, '.deepseek-code/config.json'), JSON.stringify({ model: 'deepseek-reasoner' }));

    const cfg = loadConfig({ homeDir: home, cwd });
    expect(cfg.apiKey).toBe('sk-user'); // from user
    expect(cfg.model).toBe('deepseek-reasoner'); // from project (overrides user)
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('env vars override project and user config', () => {
    const home = mkHome();
    const cwd = mkdtempSync(join(tmpdir(), 'dscproj-'));
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code/config.json'), JSON.stringify({ apiKey: 'sk-user', model: 'deepseek-chat' }));
    mkdirSync(join(cwd, '.deepseek-code'));
    writeFileSync(join(cwd, '.deepseek-code/config.json'), JSON.stringify({ model: 'deepseek-reasoner' }));

    const cfg = loadConfig({ homeDir: home, cwd, env: { DEEPSEEK_API_KEY: 'sk-env', DEEPSEEK_MODEL: 'deepseek-v4-flash' } });
    expect(cfg.apiKey).toBe('sk-env'); // from env
    expect(cfg.model).toBe('deepseek-v4-flash'); // from env (overrides project)
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('env var for numeric field parses correctly', () => {
    const home = mkHome();
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code/config.json'), JSON.stringify({ apiKey: 'sk-abc' }));
    const cfg = loadConfig({ homeDir: home, env: { DEEPSEEK_MAX_STEPS: '100', DEEPSEEK_BASH_TIMEOUT: '60000' } });
    expect(cfg.maxSteps).toBe(100);
    expect(cfg.bashTimeoutMs).toBe(60000);
    rmSync(home, { recursive: true, force: true });
  });

  it('getConfigSources returns correct field sources', () => {
    const home = mkHome();
    const cwd = mkdtempSync(join(tmpdir(), 'dscproj-'));
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code/config.json'), JSON.stringify({ apiKey: 'sk-user', model: 'deepseek-chat' }));
    mkdirSync(join(cwd, '.deepseek-code'));
    writeFileSync(join(cwd, '.deepseek-code/config.json'), JSON.stringify({ model: 'deepseek-reasoner' }));

    const sources = getConfigSources({ homeDir: home, cwd, env: { DEEPSEEK_BASE_URL: 'http://custom' } });
    expect(sources.apiKey).toBe('user');
    expect(sources.model).toBe('project'); // project overrides user
    expect(sources.baseUrl).toBe('env'); // env overrides all
    expect(sources.maxSteps).toBe('default');
    expect(sources.bashTimeoutMs).toBe('default');
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
