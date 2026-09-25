# Design

## Context

用户已切换到 opencode GUI（桌面版内置 v2.0.16 后台服务，见 proposal.md - Why）。v2 插件模型整体重写：插件以 `Plugin.define({id, setup(ctx)})` 导出，配置以 `plugins` 数组 + `{package, options}` 对象声明，功能通过 domain API（`ctx.*`）与 hooks 注册，不再有 V1 的 `{id, server}` 导出、hooks 对象、`plugin` 数组元组。现有 `src/index.ts` 全部基于 V1 API，需整体迁移。

v2 插件 API 已确认的关键能力（来自 v2 官方文档）：
- `ctx.session.hook("http.request" / "http.response" / "retry", fn, {providerID?})` —— 一等请求/响应/重试钩子，可改 headers、克隆/替换一次性 body、读响应状态
- `ctx.event.subscribe({signal})` —— 事件流（含 `message.updated`）
- `ctx.tool.transform(editor => ...)` —— 注册工具，入参为 JSON Schema（不再依赖 zod）
- `ctx.options` —— `{package, options}` 的 options
- `ctx.provider.list()/get()`、`ctx.session`、`ctx.storage` 等 domain API

## Goals / Non-Goals

**Goals:**
- 插件在 opencode v2（GUI 2.0.16）下正常加载，`plan_mate_stats` / `plan_stats` 工具可用
- key 轮询（按接入点+模型分组随机、429/402 熔断冷却、passthrough）与用量统计行为与 V1 一致
- 全局配置迁移到 v2 `plugins` 形态；登录脚本兼容 v2（并兜底 V1）
- 文档、README、文章与 v2 对齐

**Non-Goals:**
- 不处理同数组的 `superpowers` 插件（同为 V1，需其各自迁移）
- 不迁移历史统计数据（沿用 V1 的按日 JSONL，天然兼容）
- 不引入新的轮询策略或配额能力

## Decisions

### D1: 用 `ctx.session.hook("http.request"/"http.response")` 替代全局 fetch monkey-patch

V1 的 `src/fetch-patch.ts` 在模块加载时 `globalThis.fetch = ...` 全局替换，实现 key 轮询与熔断。v2 提供一等钩子，语义更清晰且不污染全局：

- `http.request`：匹配 `event.request.url` 与已配置 baseURL（`findBaseURL`）→ 克隆 body 解析 `model` → 按「接入点+模型」分组随机选非熔断 provider → `event.request.headers.set("Authorization", Bearer key)`。请求 body 为一次性流，读取前先克隆（`event.request.clone()`）并替换，避免消费原流。
- `http.response`：读 `event.response.status`，429/402 时触发对应冷却；响应体按需 `clone()` 后解析 429 分类（`exceeded` + `quota`）。
- 全部熔断 → passthrough（不改请求）；`event.kind`（primary/compaction/title/generate）不区分对待，与 V1 一致覆盖所有流量。
- 会话标识头（`X-Session-Id`）若 v2 仍注入，在 `http.request` 中读取建立 sessionID→provider 关联并删除该头（见 D5）。

**备选考虑：**
- 继续 fetch monkey-patch：技术上在插件进程内仍可行，但 v2 是多位置/多实例架构，全局 patch 的生效范围与钩子不一致，且属于绕开官方 API 的脆弱做法。**否决**。
- `ctx.session.hook("model.request", ...)` 只改请求 options，不能改 headers/URL 细节，且是 session 级语义选项，不满足按 provider 换 key 的需求。**否决**。

### D2: provider 收集 —— 从配置文件读取，必要时结合 `ctx.provider`

V1 通过 `config` hook 读 `Config.provider[name].options.{baseURL, apiKey, models}`。v2 中 apiKey 属凭证/连接模型，`ctx.provider.list()` 返回的 `Provider.Info` 是否暴露 apiKey 未定（需 spike）。设计：**保留从 `opencode.jsonc` 源文件解析 provider 定义**（`src/config.ts` 改为读取配置文件的 `provider` 段，过滤 `ctx.options.providers`），`baseURL`/`apiKey`/`models` 语义不变；若 spike 确认 `ctx.provider` 可读 apiKey 则优先走 domain API，否则维持文件解析。

### D3: 工具注册 —— `ctx.tool.transform` 替代 `tool()` + zod

`plan_mate_stats`（可选 `days` 整数）与 `plan_stats`（无参数）改为 `ctx.tool.transform(editor => editor.add({name, description, input: JSON Schema, execute}))`，入参用 JSON Schema（`{"type":"object", properties...}`）描述，移除 zod 依赖。工具名不变。

### D4: 事件订阅 —— `ctx.event.subscribe()` 替代 `event` hook

`setup(ctx)` 中 `for await (const event of ctx.event.subscribe({signal}))`，过滤 `message.updated`，token 归因、去重、60s 刷盘逻辑原样保留（`src/stats.ts` / `src/logger.ts` 不动）。setup 返回 cleanup 时 `controller.abort()`。

### D5: 关联映射与单例语义

- sessionID→provider 关联映射：由 `http.request` 钩子建立、`message.updated` 终态清理，逻辑与 V1 一致。
- 模块级共享：`StatsCollector`、`ProviderPool`、`Logger` 继续用模块级变量。v2 下 `setup` 每个加载位置调用一次，首位置初始化、后续复用，拦截器注册只做一次（共享 `http.request`/`http.response` 注册标志）。与 V1 单例语义对齐。

### D6: 配置迁移与登录脚本兼容

- 全局 `opencode.jsonc`：`plugin` 数组 → `plugins` 数组；`["file:///D:/code/opencode-plan-mate", {...}]` → `{"package": "file:///D:/code/opencode-plan-mate", "options": {...}}`。options 内容不变。
- `scripts/login-arkcli-accounts.ts` 的 `extractAccounts`：新增解析 `plugins` 数组（字符串 + 对象形态的 `options.planStats.accounts`），保留对 V1 `plugin` 元组的兼容解析（迁移过渡期）。其余登录/验证逻辑不动。

### D7: 依赖与构建

- `devDependencies`：`@opencode-ai/plugin` → `@opencode/plugin`（v2 插件包，运行时由 opencode 提供）。
- `src/index.ts` 导入 `import { Plugin } from "@opencode/plugin"`，默认导出 `Plugin.define({id: "opencode-plan-mate", async setup(ctx) {...}})`。
- 构建脚本不变（`bun build ... --target node`），`dist/index.js` 重构建。

### D8: 文档与文章

- README + `docs/` 四处文档的配置写法、机制描述（config hook / fetch-patch / event hook）更新为 v2 形态，新增「opencode v2 兼容性要求」。
- `articles/opencode-plugin-dev-guide.md`：开头加 V1 版本标注横幅，末尾新增「v2 迁移要点」章节，正文保留。

## Risks / Trade-offs

- [v2 `http.request` 钩子 body 为一次性流，解析 `model` 需 clone/replace，可能增加请求前处理开销] → 仅对匹配 baseURL 的请求做 body 克隆解析；不匹配直接返回不改动。
- [apiKey 在 v2 凭证模型下可能无法经 `ctx.provider` 读取] → D2 已留文件解析兜底；spike 先行确认。
- [v2 是否仍注入 `X-Session-Id` 请求头未知，token 归因可能退化] → 保留现有 fallback（`info.providerID`）；若头不存在，`http.request` 钩子内用 `event.sessionID` 建立关联（钩子自带 sessionID）。
- [v2 加载失败多为静默/仅日志，排查成本高] → 插件 setup 内显式打日志（`console.log` 或 v2 日志通道），并保留 `bun test` 对核心逻辑（pool/stats/解析）的单测覆盖，缩小未覆盖面。
- [v2 文档 API 与 2.0.16 实测可能有出入（文档更新快）] → 实施第一步为 spike：在 v2 环境下以最小插件验证 `Plugin.define`/`http.request`/`ctx.tool.transform`/`ctx.event.subscribe` 可用后再全量迁移。

## Migration Plan

1. **Spike（验证）**：最小 v2 插件（`Plugin.define` + `http.request` 打日志 + 一个工具）放入 `.opencode/plugins/`，在 GUI 下确认加载、钩子触发、工具可见；确认 apiKey 可达性与 `X-Session-Id` 注入。
2. **代码迁移**：`src/config.ts`（options 解析 + provider 收集）、`src/fetch-patch.ts` → 新的 v2 拦截适配层（http.request/http.response）、`src/index.ts`（入口 + 工具 + 事件订阅）、`src/quota.ts`（工具注册方式）、`src/types.ts`。核心算法（`src/pool.ts`、`src/stats.ts`、`src/logger.ts`、`src/chart.ts`、`src/fs-util.ts`）不动。
3. **依赖与构建**：package.json 换 `@opencode/plugin`，`bun install && bun run build`，`bun x tsc --noEmit` + `bun test`。
4. **配置迁移**：全局 `opencode.jsonc` 改 `plugins`；登录脚本 `extractAccounts` 兼容双形态。
5. **文档与文章**：README + docs 更新；文章历史化 + v2 章节。
6. **验证**：重启 GUI，确认插件加载、`plan_mate_stats` / `plan_stats` 可调用、轮询日志与统计落盘正常；`openspec validate` 通过。
7. **回滚**：配置改回 `plugin` 元组 + 保留旧 `dist`（git 历史）即可退回 V1；迁移后旧配置不会被 v2 加载，回滚需一并恢复配置。

## Open Questions

- `ctx.provider` 在 v2.0.16 中是否暴露 provider 的 apiKey（影响 D2 选路）——由 spike 回答，不改 spec（spec 只要求"从 provider 配置读取 baseURL/apiKey/models"）。
- v2 是否仍注入 `X-Session-Id` 请求头（影响 D5 关联映射实现细节）——由 spike 回答，不改 spec（spec 已含 fallback）。

### Spike 结论（2026-09-25，类型层验证 @opencode/plugin@2.0.16）

1. **apiKey 不暴露**：`Provider.Info` schema（`@opencode/schema/dist/provider.d.ts`）仅含 `settings`/`headers`/`body`/`id`/`name`/`activation`/`package` 等字段，**无 apiKey**（凭证属连接/凭据层）。→ D2 采用配置文件解析路径（`src/config.ts` 新增 `loadProviderConfig` 读取全局 + 所在位置 `opencode.json(c)` 的 `provider` 段，项目级覆盖全局）。
2. **sessionID 直接可用**：`SessionHttpRequest` / `SessionHttpResponse`（`dist/promise/session.d.ts`）均自带 `sessionID`，**无需 `X-Session-Id` 头**。→ D5 关联映射改为在 `http.request` 钩子里用 `event.sessionID` 建立，`http.response` 用 `event.request` 的 Authorization 头识别所用 key。
3. **工具注册**：`ctx.tool.transform` 的 `editor.add` 接受 `{name, description, input: JSON Schema, execute}`，`execute` 返回 `Promise<{content}>`（promise API）。
4. **运行时行为（GUI 重启后确认，见任务 5.1 / 8.1）**：`message.updated` 事件是否仍以 v1 兼容形态（`properties.info`）发送、钩子触发与工具可见性，待 GUI 重启后经日志验证。
