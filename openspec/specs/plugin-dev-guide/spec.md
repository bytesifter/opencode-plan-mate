# plugin-dev-guide Specification

## Purpose

插件开发指南文章的内容契约：约束文章对插件加载方式、插件 API、hooks、依赖管理与安装排障的覆盖范围，以及格式与语言合规要求。

## Requirements

### Requirement: 覆盖插件加载机制

文章 SHALL 系统讲解 opencode 插件的三种加载方式,每种 SHALL 说明配置写法、安装位置、是否传 options、适用场景。

#### Scenario: 三种加载方式均有覆盖

- **WHEN** 读者查阅文章的加载机制章节
- **THEN** 文章 SHALL 包含:本地文件(plugins/ 目录,auto-load)、npm 字符串形式(`"pkg"` 或 `"pkg@spec"`,装进 cache)、tuple 形式(`["pkg",{opts}]`,期望 config-dir node_modules)三种方式的讲解

#### Scenario: 实测结论可复现

- **WHEN** 文章描述字符串形式与 tuple 形式的安装位置差异
- **THEN** 文章 SHALL 引用实证依据(cache package.json 内容、opencode.log WARN),且结论与 `@opencode-ai/plugin@1.18.5` 的 `Config.plugin` 类型定义(`Array<string | [string, PluginOptions]>`)一致

### Requirement: 覆盖插件函数与导出形态

文章 SHALL 讲解 `Plugin` 函数签名 `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`、`PluginInput` 上下文字段、`PluginModule` 导出形态,且 SHALL 标注类型来源。

#### Scenario: 函数签名与类型定义一致

- **WHEN** 读者对照文章中的 Plugin/PluginInput/PluginModule 描述与 `@opencode-ai/plugin@1.18.5` 的 `index.d.ts`
- **THEN** 文章描述 SHALL 与类型定义一致(函数参数、PluginInput 字段、PluginModule 结构)

#### Scenario: 标注版本来源

- **WHEN** 读者查看文章开头或 API 章节
- **THEN** 文章 SHALL 标注"基于 @opencode-ai/plugin@1.18.5"

### Requirement: 覆盖 Hooks 全览

文章 SHALL 列出 `Hooks` 接口的全部 hook,每个含用途说明;其中 `config`、`event`、`tool`、`chat.headers` SHALL 配代码示例。文章 SHALL 明确指出 `config` hook 存在于类型定义但官方文档未展示。

#### Scenario: config hook 被覆盖且标注文档缺失

- **WHEN** 读者查阅 Hooks 章节
- **THEN** 文章 SHALL 讲解 `config` hook 的签名与用途,并注明"此 hook 存在于类型定义但官方 plugins 文档未展示"

#### Scenario: 核心 hooks 有代码示例

- **WHEN** 读者查阅 config/event/tool/chat.headers 的讲解
- **THEN** 每个 hook SHALL 配一段可读的代码示例(非伪代码,可对照类型定义)

### Requirement: 覆盖自定义工具与配置传递

文章 SHALL 讲解 `tool()` helper 的用法(Zod schema + execute)、`ToolContext` 字段;SHALL 说明 `plugin` 字段的 string/tuple 两种形式及 options 传递机制。

#### Scenario: tool helper 完整示例

- **WHEN** 读者查阅自定义工具章节
- **THEN** 文章 SHALL 提供一个完整的 `tool({ description, args, execute })` 示例,含 Zod schema 定义和 execute 返回值

#### Scenario: options 传递机制清晰

- **WHEN** 读者查阅配置章节
- **THEN** 文章 SHALL 说明 tuple 形式 `["pkg", {opts}]` 传 options、字符串形式不传,并引用 `Config.plugin` 类型

### Requirement: 覆盖依赖管理与 SDK Client API

文章 SHALL 讲解本地插件如何用外部 npm 包(config 目录 package.json)、`@opencode-ai/plugin` 的运行时提供角色;SHALL 列出插件可用的 SDK Client API(`config.get`/`session.*`/`event.subscribe`/`tui.*` 等)。

#### Scenario: @opencode-ai/plugin 角色说明

- **WHEN** 读者查阅依赖管理章节
- **THEN** 文章 SHALL 说明 `@opencode-ai/plugin` 运行时由 opencode 提供,插件本地只需 devDependencies(供类型检查),无需写进 runtime dependencies

#### Scenario: SDK Client API 列表

- **WHEN** 读者查阅 SDK 章节
- **THEN** 文章 SHALL 列出 `client.config`/`client.session`/`client.event`/`client.tui`/`client.app` 等命名空间及其关键方法

### Requirement: 覆盖安装机制内幕与 @local 踩坑

文章 SHALL 包含安装机制内幕(cache vs config-dir 的实测结论)与 `@local` 问题描述;SHALL 提供可复现的排查步骤;SHALL 如实标注当前状态(未解决,附已知方向)。

#### Scenario: @local 问题有可复现排查步骤

- **WHEN** 读者按文章排查自己的插件安装问题
- **THEN** 文章 SHALL 提供:查 opencode.log 的 WARN、查 cache package.json、手动 bun install 对照三步可复现的排查流程

#### Scenario: 当前状态如实标注

- **WHEN** 读者查阅 @local 问题的结论
- **THEN** 文章 SHALL 如实写明"当前未解决",并列出已知方向(字符串形式绕过 / bun overrides / 报 opencode bug),不假装已解决

### Requirement: 包含实战章节

文章 SHALL 包含一个迷你版插件实战章节,组合 `config`/`event`/`tool` hooks 写一个可工作的插件(简化自 round-robin),代码片段 SHALL 标注来源 file:line。

#### Scenario: 实战组合多种 hooks

- **WHEN** 读者阅读实战章节
- **THEN** 示例插件 SHALL 至少组合 config hook(读配置)+ event hook(记事件)+ tool(注册工具)三种 hook,展示如何串联

#### Scenario: 代码片段标注来源

- **WHEN** 实战章节引用 round-robin 的代码
- **THEN** 文章 SHALL 标注来源(如 `src/index.ts:36`),并注明"为教学简化,完整实现见 src/"

### Requirement: 格式与语言合规

文章 SHALL 遵循 AGENTS-docs.md:无 `---` 水平分割线、标题层级严格递进不跳级、代码块标注语言类型、中文撰写(技术术语保留英文)、列表统一用 `-`、文件名 kebab-case。

#### Scenario: 无水平分割线

- **WHEN** 检查文章全文
- **THEN** 正文 SHALL NOT 出现 `---` 水平分割线(代码块内部不限)

#### Scenario: 代码块标注语言

- **WHEN** 检查文章所有代码块
- **THEN** 每个代码块 SHALL 标注语言类型(` ```ts ` / ` ```jsonc ` / ` ```bash ` 等),无空代码块标记

#### Scenario: 标题层级不跳级

- **WHEN** 检查文章标题结构
- **THEN** 标题层级 SHALL 严格递进(`#` -> `##` -> `###`),不出现跳级(如 `#` 后直接 `###`)
