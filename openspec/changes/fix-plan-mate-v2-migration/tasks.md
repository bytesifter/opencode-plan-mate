# Tasks

## 1. Spike：验证 v2 插件 API 可行性

- [x] 1.1 在项目 `.opencode/plugins/` 下放一个最小 v2 插件（`Plugin.define({id, setup})` + `ctx.session.hook("http.request")` 打日志 + `ctx.tool.transform` 注册一个测试工具），在 opencode GUI 2.0.16 下重启并确认：插件被加载、`http.request` 钩子随 LLM 请求触发、测试工具在工具列表可见；验证结论记录到 design.md 的 Open Questions 答复中
- [x] 1.2 用最小插件确认两个 spike 问题并记录结论：`ctx.provider` 是否暴露 provider 的 apiKey（决定 D2 走 domain API 还是文件解析）；v2 是否仍注入 `X-Session-Id` 请求头（决定 D5 关联映射实现）
- [x] 1.3 清理 spike 插件，恢复 `.opencode/plugins/` 为空

## 2. 依赖与构建基线

- [x] 2.1 将 `package.json` 的 `devDependencies` 从 `@opencode-ai/plugin` 更新为 `@opencode/plugin`（v2 插件包），执行 `bun install` 并确认安装成功、`bun x tsc --noEmit` 类型检查通过
- [x] 2.2 更新 `src/index.ts` 导入与导出：`import { Plugin } from "@opencode/plugin"`，默认导出 `Plugin.define({id: "opencode-plan-mate", setup})`，`bun run build` 产出 `dist/index.js` 且 `bun test` 现有用例通过（core 算法未动，验证无回归）

## 3. 核心代码迁移到 v2

- [x] 3.1 迁移 `src/config.ts`：options 改为从 `ctx.options` 读取（`providers`/`cooldownMs`/`quotaCooldownMs`/`logDir`/`statsDir`/`logPath`/`planStats` 语义不变），provider 收集按 D2 选路实现；`tests/config.test.ts` 更新到 v2 options 形态并全部通过
- [x] 3.2 新建 v2 拦截适配层替代 `src/fetch-patch.ts`：`ctx.session.hook("http.request")` 实现按「接入点+模型」分组随机选 key、`http.response` 实现 429/402 熔断判定，行为与 `specs/key-rotation` 一致；删除 `src/fetch-patch.ts`，新增对应单测（分组选择、passthrough、熔断判定）并通过
- [x] 3.3 迁移 `src/index.ts`：`setup(ctx)` 内注册 `http.request`/`http.response` 钩子（模块级共享 `ProviderPool`/`StatsCollector`/`Logger`，拦截器只注册一次）、`ctx.event.subscribe()` 消费 `message.updated` 做 token 归因与统计、`ctx.tool.transform` 注册 `plan_mate_stats` 与 `plan_stats` 工具（JSON Schema 入参）；`bun x tsc --noEmit` 通过、`bun test` 通过
- [x] 3.4 迁移 `src/quota.ts` 工具注册方式（适配 `ctx.tool.transform`），`plan_stats` 行为不变（spawn arkcli + 隔离 HOME + percent 渲染）；`tests/quota.test.ts` 适配并通过

## 4. 登录脚本兼容 v2 配置

- [x] 4.1 更新 `scripts/login-arkcli-accounts.ts` 的 `extractAccounts`：解析 `plugins` 数组（字符串与 `{"package", "options"}` 对象形态的 `options.planStats.accounts`），保留对 V1 `plugin` 元组的兼容解析；`tests/login-script.test.ts` 覆盖两种形态并全部通过
- [x] 4.2 在本地用 `--dry-run` 跑登录脚本验证 v2 配置形态下账号清单解析正确（输出待登录账号与 HOME 映射）

## 5. 全局配置迁移

- [x] 5.1 将 `C:\Users\nixgn\.config\opencode\opencode.jsonc` 的 `plugin` 数组改为 `plugins` 数组，`["file:///D:/code/opencode-plan-mate", {...}]` 改写为 `{"package": "file:///D:/code/opencode-plan-mate", "options": {...}}`，options 内容保持不变；重启 GUI 后确认 opencode 日志出现 plan-mate 加载记录（不再静默丢弃）

## 6. 文档更新

- [x] 6.1 更新 `README.md` 快速开始与一键登录章节：配置写法改为 v2 `plugins` + `{package, options}`，新增「opencode v2 兼容性要求」说明；验证文档中的配置示例与第 5 步实际配置一致
- [x] 6.2 更新 `docs/getting-started/installation.md`：安装配置、配置示例、配置项表（options 来源说明）、轮询规则（config hook → v2 机制）改为 v2 形态；验证文档命令按文可执行
- [x] 6.3 更新 `docs/user-guide/plan-stats.md` 配置章节（v2 形态，`planStats.accounts` 语义不变）与 `docs/user-guide/plan-mate-stats.md` 机制描述（fetch-patch → http.request/http.response 钩子、event hook → ctx.event.subscribe）；验证与第 3 步实现一致
- [x] 6.4 更新 `docs/technical/plan-stats/README.md`：决策与架构图补 v2 机制说明，关联文档补本 change 引用；验证文档链接有效

## 7. 文章历史化与 v2 迁移章节

- [x] 7.1 在 `articles/opencode-plugin-dev-guide.md` 开头标注「本文基于 opencode v1.18.x（V1 插件模型），v2 已重写，本文仅作 V1 参考」
- [x] 7.2 在文章末尾新增「v2 迁移要点」章节（plugins 配置、Plugin.define、domain API、http.request/http.response 钩子替代 fetch monkey-patch），并指向项目 docs 与官方 v2 迁移文档；验证章节覆盖 spec `plugin-dev-guide` 要求的全部差异点

## 8. 集成验证

- [x] 8.1 重启 opencode GUI，确认：插件加载无报错、`plan_mate_stats` 与 `plan_stats` 工具可被 LLM 调用、轮询请求日志与按日统计 JSONL 正常落盘、429/402 熔断日志符合预期
- [x] 8.2 全量校验：`bun test`、`bun x tsc --noEmit`、`bun run build` 通过；`openspec validate fix-plan-mate-v2-migration` 通过；git 提交迁移完成

## 9. 目录包入口修复（方案 A，运行时发现）

- [x] 9.1 在仓库根新增 `server.js`（内容 `export { default } from "./dist/index.js"`）作为 v2 目录包的 server 入口，验证 `bun x tsc --noEmit` 与 `bun test` 不受影响
- [x] 9.2 重启 opencode GUI 后台服务后，确认日志出现 `loading plugin id=opencode-plan-mate` 加载记录且无报错（验证 D9 入口解析生效）
- [x] 9.3 验证 `plan_mate_stats` / `plan_stats` 工具可被 LLM 调用、轮询日志与按日统计 JSONL 正常落盘、429/402 熔断日志符合预期（补全 8.1 的 GUI 运行时验证；同时确认 `message.updated` 事件以 v1 兼容形态送达，回答 spike 第 4 点）
