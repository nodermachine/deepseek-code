/**
 * @file 内置流程 skills（代码内嵌，不走磁盘加载）
 *
 * 这三个 skill 覆盖调试、设计、验证三大流程环节。为什么必须代码内嵌？
 *
 * 情景反例：如果它们放到 .deepseek-code/skills/*.md 里靠 loader 加载，那
 * 一旦 loader 本身出 bug（比如 v0.3 早期那次 YAML frontmatter 全丢的问题），
 * 本该救火的这三个 skill 也一并挂掉，形成"bug 保护自己"的死循环。
 * 塞进代码里就与文件系统解耦，永远在场。
 *
 * 用户级 skill 同名可以覆盖内置版本（见 mergeBuiltinSkills）——留一个逃生口。
 */

import type { Skill } from './types.js';

const SYSTEMATIC_DEBUGGING = `
遇到 bug、测试失败、意外行为时，走这套流程，不要跳步：

1. **复现**：先用 Bash/Read 把问题稳定地复现出来，把命令和实际输出都记录下来。没能复现之前不要提假设。
2. **列 ≥3 个假设**：不要看 1 眼日志就锁定一个原因。至少列 3 个"可能是 X"，写出各自的证据方向。
3. **逐个排除**：为每个假设写一个能证伪它的观察（"如果是 X，那 grep 应该看到 Y"）。跑，看结果。
4. **最小修改**：定位到病灶后，只改导致 bug 的那处，不顺手做"看起来更好"的重构。
5. **复现验证**：改完再跑一次原来的复现命令，输出必须变成期望值。跑单元测试不算，除非测试就是原复现路径。

反模式：
- 只看到"文件格式不对"就改文件，不查是不是解析器错了
- 只跑单测就宣布 fix 完成，从没重跑真实场景
- 加日志/加防御式判断而不定位根因
- 一次改动混杂"修 bug"+"顺手清理"
`.trim();

const BRAINSTORMING = `
用户说"实现 X"、"加个 Y"、"重构 Z"这类**非平凡**任务时，先设计再动手：

1. **确认范围**：这次改动动到哪些文件/模块？只字面理解会不会错过前置条件？必要时**先问一个问题澄清**再动手，而不是猜。
2. **看现状**：改之前先 grep/Read 现有实现，确认接口/约定/命名习惯。别造重复的抽象，别在跟项目风格冲突的方向上开始写。
3. **给出 2-3 个方案**：即便你已经有偏好，也列出 2-3 个替代方案 + trade-off，让用户能否决你。**不要单方案独走**。
4. **拿到确认再写代码**：如果任务预期需要 ≥3 个文件、≥100 行改动、或者动到 core/permission/loader/registry 这类基础设施，务必先写一段计划（/plan）并等用户 OK。
5. **YAGNI**：不为"未来可能用到"加抽象。三处相似的代码好过一个早熟的抽象。

反模式：
- 立即开始 Edit，跳过看代码
- 单方案直冲，让用户被动接受
- 一次动 10 个文件却没告诉用户你在做什么
- 加"以后要用"的配置项、feature flag、backwards-compatibility shim
`.trim();

const VERIFY_BEFORE_COMPLETION = `
声称"完成"、"修好了"、"测试通过"、"验证无破坏"之前，必须走这步。不例外。

1. **重跑原场景**：原始 bug 是通过哪条命令/交互暴露的？就跑那条。粘贴真实输出。不要复述、不要意译、不要"看起来正常了"。
2. **区分层级**：\`tsc + vitest\` 全绿只证明"编译过、单测通过"，不证明"用户报告的 REPL 行为修好了"。功能验证必须触及原报告的入口。
3. **不能自动验证的情况**：需要 TUI 交互、需要真实 API 调用、需要外部依赖时，**明说**"此项需人工验证：请运行 X，看到 Y 则通过"，不要装作已经过了。
4. **反向对比**：如果 bug 是"少了什么"或"多了什么"（比如"应该只有 6 个 skill，却显示 62 个"），验证时给出**改前 → 改后**的数字/差异，让用户一眼能核对。
5. **禁用早期宣告**：不要在流程中间说"✅ 全部通过"。总结段（含 emoji、"完成"、粗体结论）只能在你贴完真实输出之后。

反模式：
- "所有测试通过 ✅"但从没跑触发 bug 的那条命令
- 用 markdown 表格美化空结论
- 单测通过就说"修复安全无破坏"
`.trim();

export function getBuiltinSkills(): Skill[] {
  return [
    {
      name: 'systematic-debugging',
      description: '遇到 bug / 测试失败 / 意外行为时的调试流程：复现 → 3 个假设 → 排除 → 最小修改 → 复现验证',
      trigger: {
        type: 'auto',
        keywords: [
          'bug', 'debug', 'debugging', 'error', 'fails', 'failing', 'broken',
          '出错', '报错', '不对', '不生效', '坏了', '有 bug', '有bug', '失败', '不通过', '不行',
          'traceback', 'exception', 'stack trace', '为什么', 'why does', "doesn't work",
        ],
      },
      content: SYSTEMATIC_DEBUGGING,
      filePath: '<builtin>',
    },
    {
      name: 'brainstorming',
      description: '实现新功能 / 重构 / 修改行为前的设计流程：确认范围 → 看现状 → 2-3 方案 → 拿到确认',
      trigger: {
        type: 'auto',
        keywords: [
          'implement', 'build', 'add a new', 'create a new', 'refactor', 'redesign',
          '实现', '加一个', '新增', '重构', '重新设计', '开发', '写一个', '搞一个', '做个',
        ],
      },
      content: BRAINSTORMING,
      filePath: '<builtin>',
    },
    {
      name: 'verification-before-completion',
      description: '声称"完成/修好/通过"之前必须重跑原场景并贴真实输出的验证协议',
      trigger: { type: 'always' },
      content: VERIFY_BEFORE_COMPLETION,
      filePath: '<builtin>',
    },
  ];
}
