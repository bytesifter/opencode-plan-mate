# Spec Delta

## MODIFIED Requirements

### Requirement: 插件以路径形式声明

全局 `opencode.jsonc` 的 `plugins` 数组中,`opencode-plan-mate` SHALL 以路径形式声明(`{"package": "file:///<路径>", "options": {...}}` 对象或 `file:///<路径>` 字符串)。v2 不再识别 V1 的 `plugin` 数组 + `["file:///路径", options]` 元组形态,该形态条目 SHALL NOT 被加载。v2 对目录包在包根按 `server` / `index` 顺序解析入口(`Host.resolve`),SHALL NOT 依赖 `package.json` 的 `main` 字段;仓库根 `server.js` SHALL re-export 预构建产物 `./dist/index.js` 作为该入口。

#### Scenario: 路径声明被识别为 path plugin

- **WHEN** opencode v2 解析 `opencode.jsonc` 的 `plugins` 配置,条目为 `{"package": "file:///D:/code/opencode-plan-mate", "options": {...}}` 或等价路径字符串
- **THEN** 该条目 SHALL 按本地路径插件解析(不当作 npm 包名查找),options SHALL 传入插件 `setup(ctx)` 的 `ctx.options`

#### Scenario: 插件入口解析为 JavaScript 文件

- **WHEN** opencode v2 加载目录包 `file:///D:/code/opencode-plan-mate`,包根存在 `server.js`
- **THEN** 入口 SHALL 解析为该 `server.js`,其 `export { default } from "./dist/index.js"` SHALL 透出 v2 插件默认导出(`{id, setup}`)
- **AND** SHALL NOT 依赖 `package.json` 的 `main` 字段(目录包不做包名式解析)

#### Scenario: V1 元组形态不被加载

- **WHEN** 配置仍使用 V1 的 `plugin` 数组 + `["file:///路径", options]` 元组
- **THEN** 该条目 SHALL NOT 被加载(插件不注册任何钩子与工具)

### Requirement: 模块级单例(多项目共享)

插件 SHALL 使用模块级变量实现单例:`StatsCollector`、`ProviderPool`、`Logger` 与拦截注册标志。v2 下 `setup(ctx)` 在每个加载位置被调用一次,多次调用(每位置一次)SHALL 复用已存在的单例,不创建新实例;`http.request`/`http.response` 拦截器 SHALL 只注册一次,后续位置的 setup SHALL 跳过重复注册。

#### Scenario: StatsCollector 单例

- **WHEN** opencode 在多个位置调用 `setup(ctx)`
- **THEN** 所有调用 SHALL 共用同一个 `StatsCollector` 实例(单一 `setInterval` timer,单一 `store`)

#### Scenario: stats.json 不被空实例覆写

- **WHEN** 位置 A 有 LLM 请求(累积统计数据),位置 B 无 LLM 请求(空 store),两者的 `flush()` 依次执行
- **THEN** 按日 JSONL 统计 SHALL 保留位置 A 的数据,SHALL NOT 被位置 B 的空 store 覆写

#### Scenario: patchFetch 只安装一次

- **WHEN** opencode 在多个位置调用 `setup(ctx)`
- **THEN** `ctx.session.hook("http.request")` / `ctx.session.hook("http.response")` SHALL 只被注册一次(首次 setup),后续 setup SHALL 跳过重复注册

#### Scenario: ProviderPool 跨项目共享

- **WHEN** 位置 A 的请求触发某 provider 的 429 熔断
- **THEN** 位置 B 的请求 SHALL 也跳过该 provider(共享 `ProviderPool`,熔断跨项目生效)

### Requirement: 插件加载后注册 hooks 与工具

插件被 opencode v2 成功加载后,`setup(ctx)` SHALL 注册 `ctx.session.hook("http.request")` 与 `ctx.session.hook("http.response")`(key 轮询与熔断)、`ctx.event.subscribe()`(用量统计与 token 日志),以及 `ctx.tool.transform` 注册 `plan_mate_stats` 与 `plan_stats` 工具。

#### Scenario: roundrobin_stats 工具可调用

- **WHEN** opencode 启动且插件成功加载,LLM 调用 `plan_mate_stats` 工具
- **THEN** 工具 SHALL 返回按天的 ASCII 柱状图字符串(或"暂无统计数据")

#### Scenario: 未配置 providers 时不注册拦截

- **WHEN** `ctx.options.providers` 缺失或为空
- **THEN** 插件 SHALL 不注册 `http.request`/`http.response` 拦截器,其余能力(如 `plan_stats` 工具)SHALL 不受影响

### Requirement: 本地开发不受影响

构建脚本和 `main` 改动 SHALL NOT 影响 `bun test` 和 `bun x tsc --noEmit` 的类型解析。`@opencode/plugin`(v2 插件包)在 `devDependencies` 中,本地 `bun install` 仍安装到项目 `node_modules`。

#### Scenario: tsc 类型检查通过

- **WHEN** 在项目根目录执行 `bun x tsc --noEmit`
- **THEN** 类型检查 SHALL 通过(无 "找不到模块 @opencode/plugin" 错误)

#### Scenario: 测试通过

- **WHEN** 在项目根目录执行 `bun test`
- **THEN** 所有测试 SHALL 通过
