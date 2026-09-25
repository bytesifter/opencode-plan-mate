# Proposal

## Why

用户已从 opencode CLI（1.x）切换到 opencode GUI（桌面版，内置 opencode v2.0.16）。v2 插件模型整体重写：不运行 V1 插件（`{id, server}` 导出 + hooks 对象），配置项也从 `plugin` 数组改为 `plugins` 数组 + `{package, options}` 对象。当前插件在 v2 下**从未被加载**（日志零记录，`file:///` 元组条目被静默丢弃），`plan_mate_stats` / `plan_stats` 工具与 key 轮询全部失效。需要将插件、配置与文档整体迁移到 v2 插件模型。

## What Changes

- **BREAKING 配置形态**：全局 `opencode.jsonc` 的 `plugin` 数组 + `["file:///目录", {options}]` 元组 → v2 `plugins` 数组 + `{"package": "file:///...", "options": {...}}` 对象（或等价字符串路径）。`providers`、`cooldownMs`、`quotaCooldownMs`、`logDir`、`statsDir`、`planStats.accounts` 等 options 语义不变。
- **BREAKING 插件入口**：`src/index.ts` 从 V1 `PluginModule {id, server}`（hooks 对象）迁移到 V2 `Plugin.define({id, setup(ctx)})`；依赖从 `@opencode-ai/plugin`（V1）升到 `@opencode/plugin`（V2）。
- **BREAKING 拦截机制**：key 轮询从全局 `fetch` monkey-patch 迁移到 v2 一等钩子 `ctx.session.hook("http.request")`（按接入点+模型随机换 key/Authorization）与 `ctx.session.hook("http.response")`（429/402 熔断判定），保留现有按"接入点 + 模型"分组随机、熔断/冷却、passthrough 语义。
- **工具注册**：`plan_mate_stats` / `plan_stats` 从 V1 `tool` hook 迁移到 `ctx.tool.transform`（JSON Schema 入参，替代 zod）。
- **事件订阅**：用量统计从 V1 `event` hook 迁移到 `ctx.event.subscribe()`。
- **登录脚本**：`scripts/login-arkcli-accounts.ts` 的 `extractAccounts` 同步支持 v2 `plugins` 配置形态解析 `planStats.accounts`。
- **文档同步**：README 与 `docs/getting-started/installation.md`、`docs/user-guide/plan-stats.md`、`docs/user-guide/plan-mate-stats.md`、`docs/technical/plan-stats/README.md` 的配置写法、机制描述（config hook / fetch-patch / event hook）更新为 v2 形态，并新增「opencode v2 兼容性要求」说明。
- **文章处理**：`articles/opencode-plugin-dev-guide.md` 标注「基于 opencode v1.18.x，为 V1 插件模型参考」，并新增 v2 迁移要点章节，正文保留为 V1 历史文档。

## Capabilities

### New Capabilities

- （无。迁移不引入全新行为能力，均为对既有能力的修改。）

### Modified Capabilities

- `plugin-loading`：加载机制整体迁移到 v2 —— 配置声明形态（`plugins` + `{package, options}` 或 `.opencode/plugins/` 自动加载）、导出格式（`Plugin.define({id, setup})`）、模块生命周期语义（setup 每加载位置一次，替代 V1 每项目调用 `server()` 的模块级单例）。
- `key-rotation`：provider 收集与请求拦截机制迁移到 v2 —— 从「`config` hook 读 `Config.provider` + 全局 fetch monkey-patch」改为「`ctx.provider`/配置读取 + `ctx.session.hook("http.request"/"http.response")`」。轮询分组、429/402 熔断冷却、passthrough 行为语义保持不变。
- `usage-tracking`：事件订阅从 V1 `event` hook 迁移到 `ctx.event.subscribe()`，按天累计与按日 JSONL 落盘行为不变。
- `self-contained-build`：依赖从 `@opencode-ai/plugin` 迁移到 `@opencode/plugin`（V2），构建产物与 devDependencies 约定相应调整；自包含分发语义不变。
- `account-login-script`：配置解析从 V1 `plugin` 数组元组改为 v2 `plugins` 数组对象形态（`{"package": ..., "options": {"planStats": ...}}`），其余登录/验证行为不变。
- `plugin-dev-guide`：文章标注 V1 版本基础（opencode v1.18.x）为历史参考，并新增 v2 迁移要点章节；V1 正文内容保持不变。

## Impact

- **配置**：`C:\Users\nixgn\.config\opencode\opencode.jsonc` 的 `plugin` 数组改写为 `plugins`；README 与 docs 中的配置示例同步。
- **代码**：`src/index.ts`（入口/hooks/工具/事件）、`src/config.ts`（options 解析与 provider 收集）、`src/fetch-patch.ts`（替换为 v2 http hooks 适配层）、`src/quota.ts`（工具注册方式）、`scripts/login-arkcli-accounts.ts`（配置解析）。
- **依赖**：`@opencode-ai/plugin` → `@opencode/plugin`（devDependencies）；构建产物 `dist/index.js` 重构建。
- **文档**：README + `docs/` 三层文档 + `articles/opencode-plugin-dev-guide.md`（文章历史化 + v2 迁移章节）。
- **连带**：`superpowers` 插件（同数组、同格式问题）本次不处理，但文档注明其同样需 v2 迁移；plan_stats 依赖的每账号隔离 HOME SSO 登录机制不变。
