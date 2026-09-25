# plugin-loading Specification

## Purpose

插件加载与生命周期能力：定义插件在 opencode 中的声明形态、导出格式、模块共享状态与钩子/工具注册行为，是插件可加载、可使用的行为契约。

## Requirements

### Requirement: 插件以路径形式声明

`~/.config/opencode/opencode.jsonc` 的 `plugin` 数组中,`opencode-round-robin` SHALL 以 `file:///` 路径形式声明(而非包名),使 `resolvePluginTarget` 走 `resolvePathPluginTarget` 直接解析,绕过 cache 目录的 `npm.add()` 查找。

#### Scenario: 路径声明被识别为 path plugin

- **WHEN** opencode 解析 `opencode.jsonc` 的 plugin 配置
- **THEN** `isPathPluginSpec("file:///D:/code/projects/opencode-round-robin")` SHALL 返回 true,走 `resolvePathPluginTarget` 而非 `npm.add()`

#### Scenario: 插件入口解析为 JavaScript 文件

- **WHEN** `resolvePathPluginTarget` 读取插件目录的 `package.json`
- **THEN** `main` 字段 SHALL 指向 `.js` 文件(`./dist/index.js`),而非 `.ts` 文件

### Requirement: 模块级单例(多项目共享)

插件模块 SHALL 使用模块级变量实现单例:`StatsCollector`、`ProviderPool`、`Logger`、`patchFetch` 安装标志。`server()` 函数被多次调用时(每项目一次),SHALL 复用已存在的单例,不创建新实例。

#### Scenario: StatsCollector 单例

- **WHEN** opencode 为多个项目调用 `server()`
- **THEN** 所有调用 SHALL 共用同一个 `StatsCollector` 实例(单一 `setInterval` timer,单一 `store`)

#### Scenario: stats.json 不被空实例覆写

- **WHEN** 项目 A 有 LLM 请求(累积统计数据),项目 B 无 LLM 请求(空 store),两者的 `flush()` 依次执行
- **THEN** `round-robin-stats.json` SHALL 保留项目 A 的数据,SHALL NOT 被项目 B 的空 store 覆写为 `{}`

#### Scenario: patchFetch 只安装一次

- **WHEN** opencode 为多个项目调用 `config` hook
- **THEN** `globalThis.fetch` SHALL 只被 patch 一次(首次 `config` hook 执行),后续 `config` hook SHALL 跳过 patchFetch

#### Scenario: ProviderPool 跨项目共享

- **WHEN** 项目 A 的请求触发某 provider 的 429 熔断
- **THEN** 项目 B 的请求 SHALL 也跳过该 provider(共享 `ProviderPool`,熔断跨项目生效)

### Requirement: 插件加载后注册 hooks 与工具

插件被 opencode 成功加载后 SHALL 注册 `config` hook(收集 provider 列表并安装 fetch-patch)、`event` hook(累计统计与 token 日志),以及 `roundrobin_stats` 工具。

#### Scenario: roundrobin_stats 工具可调用

- **WHEN** opencode 启动且插件成功加载,LLM 调用 `roundrobin_stats` 工具
- **THEN** 工具 SHALL 返回按天的 ASCII 柱状图字符串(或"暂无统计数据")

### Requirement: 本地开发不受影响

构建脚本和 `main` 改动 SHALL NOT 影响 `bun test` 和 `bun x tsc --noEmit` 的类型解析。`@opencode-ai/plugin` 在 `devDependencies` 中,本地 `bun install` 仍安装到项目 `node_modules`。

#### Scenario: tsc 类型检查通过

- **WHEN** 在项目根目录执行 `bun x tsc --noEmit`
- **THEN** 类型检查 SHALL 通过(无 "找不到模块 @opencode-ai/plugin" 错误)

#### Scenario: 测试通过

- **WHEN** 在项目根目录执行 `bun test`
- **THEN** 所有测试 SHALL 通过
