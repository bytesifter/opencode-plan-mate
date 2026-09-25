# opencode 插件开发指南：从 429 限流到多 Key 自动轮询

> **版本标注**：本文基于 **opencode v1.18.x（V1 插件模型）**。opencode v2 已整体重写插件模型（`plugins` 配置、`Plugin.define` 导出、domain API），本文仅作 V1 历史参考；v2 差异见文末「v2 迁移要点」。

## 背景

日常用 opencode 写代码，单个 API Key 频繁触发 429 限流。手头有 6 个高级版账号（coding + plan 端点），虽然 `opencode.jsonc` 可以配多个 provider，但 `model` 一次只能指向一个，手动切换账号很繁琐，而且无法自动应对 429 限流。

于是写了个插件 `opencode-round-robin`：每次请求随机选一个 provider，key 和端点一起换，429 自动熔断跳过（区分配额耗尽熔断 1 小时与请求太快熔断 1 分钟），全部熔断时回退到 opencode 原生请求。附带按天用量统计和结构化日志。

完整代码：[https://github.com/bytesifter/opencode-round-robin](https://github.com/bytesifter/opencode-round-robin)（本文基于 opencode v1.18.5）

### 为什么不用 API 网关？

opencode 没有内置多 key 轮询，其他 vibe coding agent（Cursor、Windsurf、Continue、Aider、Cline）也没有。能做多 key 轮询的方案对比：

```
API 网关方案 (new-api / one-api / LiteLLM):
  opencode ──▶ 网关进程(独立服务+数据库+Web UI) ──▶ API
  功能全,但太重: 额外进程,额外端口,额外维护

插件方案 (opencode-round-robin):
  opencode + 插件(monkey-patch fetch) ──▶ API
  零额外进程,零数据库,零 Web UI,~740 行代码搞定
```

网关方案适合团队共享和精细管控。个人开发者只想多几个 key 轮着用，插件方案最轻：装上即用，不需要部署和维护额外服务。

本文以这个插件为例，系统讲解 opencode 插件开发：从加载方式到 API 到踩坑，帮你从零写出一个能工作的插件。

## 一、opencode 插件能做什么

opencode 插件是一个 JS/TS 模块，通过实现 hooks 扩展 opencode 的行为。一个插件能做的事：

- 拦截和修改发往 LLM 的 HTTP 请求（`chat.headers` 注入 Authorization、`chat.params` 改参数）
- 监听事件（`event` hook：message.updated、session.idle、file.edited 等）
- 注册自定义工具（`tool` hook，LLM 可调用你定义的工具）
- 读取和修改 opencode 配置（`config` hook，能拿到完整 Config）
- 注入 shell 环境变量（`shell.env`）
- 自定义 compaction（`experimental.session.compacting`）
- 注册自定义 provider 和认证方式（`provider`、`auth`）

一句话：插件是 opencode 的扩展点，能在请求、事件、工具、配置等多个层面介入。本文系统讲解插件模型，从加载方式到 API 到踩坑，帮你从零写出一个能工作的插件。

## 二、三种加载方式

opencode 支持三种插件加载方式，它们的安装位置和配置传递机制各不相同。

### 2.1 本地文件（auto-load）

把 `.js` 或 `.ts` 文件放进插件目录，启动时自动加载，无需 install：

- `~/.config/opencode/plugins/` — 全局插件
- `.opencode/plugins/` — 项目级插件

每个文件是一个独立插件。无需 `package.json`，无需 `bun install`。要用外部 npm 包时，在 config 目录放 `package.json` 声明依赖（见第七章）。

### 2.2 npm 字符串形式

在 `opencode.jsonc` 的 `plugin` 数组里写包名或包名@spec：

```jsonc
{
  "plugin": [
    "opencode-helicone-session",
    "superpowers@git+https://github.com/obra/superpowers.git"
  ]
}
```

opencode 启动时用 Bun 安装，缓存在 `~/.cache/opencode/node_modules/`。字符串形式**不传 options**。

### 2.3 tuple 形式

在 `plugin` 数组里写 `["包名", { options }]`，第二个元素会作为 `options` 传给插件函数：

```jsonc
{
  "plugin": [
    ["opencode-round-robin", { "providers": ["account1", "account2"] }]
  ]
}
```

### 2.4 实测结论

通过对照 `~/.cache/opencode/package.json`（opencode 生成）和 `~/.config/opencode/package.json`（用户管理），得出以下结论：

| 方式 | 装哪 | 传 options | 机制 |
|------|------|-----------|------|
| 本地文件 | 不装，直接从 plugins/ 目录加载 | 无 | auto-load |
| npm 字符串 | `~/.cache/opencode/node_modules/` | 无 | opencode 写入 cache package.json，bun install |
| tuple | 期望在 `~/.config/opencode/node_modules/` | 有 | 靠 config 目录 package.json 的 `file:` 依赖 |

关键发现：**tuple 形式不进 cache package.json**。opencode 期望 tuple 形式的包已通过 config 目录的 `package.json`（如 `"opencode-round-robin": "file:D:/..."`）安装到 `~/.config/opencode/node_modules/`。如果该 install 失败，tuple 插件不会加载（详见第十章）。

## 三、插件函数与导出

### 3.1 Plugin 函数签名

来源：`index.d.ts:51`

```ts
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;
```

插件是一个异步函数，接收两个参数：

- `input: PluginInput` — opencode 注入的上下文
- `options?: PluginOptions` — 来自 tuple 形式的配置（`Record<string, unknown>`），字符串形式时为 `undefined`

返回 `Hooks` 对象，声明插件要拦截的 hook。

### 3.2 PluginInput 上下文

来源：`index.d.ts:36-46`

```ts
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>;  // opencode SDK client
  project: Project;                                  // 当前项目信息
  directory: string;                                 // 当前工作目录
  worktree: string;                                  // git worktree 路径
  experimental_workspace: { register(...) };          // workspace adapter
  serverUrl: URL;                                    // opencode server URL
  $: BunShell;                                       // Bun shell API
};
```

| 字段 | 用途 |
|------|------|
| `client` | 调 SDK API（读配置、管会话、控制 TUI 等，见第八章） |
| `project` | 当前项目信息 |
| `directory` | 当前工作目录（解析相对路径用） |
| `worktree` | git worktree 根路径 |
| `$` | Bun shell，执行命令（`await $\`ls\``） |

### 3.3 PluginModule 导出形态

来源：`index.d.ts:52-56`

npm 包或 tuple 形式的插件，`default export` 一个 `PluginModule`：

```ts
export type PluginModule = {
  id?: string;        // 插件标识（可选）
  server: Plugin;     // 等价于 Plugin 函数
  tui?: never;        // TUI 模块（本项目不涉及）
};
```

完整示例：

```ts
import { tool, type Plugin, type PluginModule } from "@opencode-ai/plugin"

const server: Plugin = async (input, options) => {
  // input.client / input.directory / input.$ ...
  // options 来自 tuple 第二个元素
  return {
    config: async (config) => { /* 读配置 */ },
    event: async ({ event }) => { /* 监听事件 */ },
    tool: { my_tool: tool({ /* ... */ }) },
  }
}

const pluginModule: PluginModule = {
  id: "my-plugin",
  server,
}

export default pluginModule
```

本地文件插件也可以用更简单的形式（命名导出 Plugin 函数），两种形态都支持。

## 四、Hooks 全览

`Hooks` 接口（来源：`index.d.ts:173-322`）定义了插件可以实现的所有 hook。

### 4.1 全部 hook 一览

| Hook | 签名要点 | 用途 |
|------|---------|------|
| `config` | `(input: Config) => Promise<void>` | 读/改 opencode 配置（provider、model 等）。**官方文档未展示此 hook，但类型定义中存在** |
| `event` | `({ event: Event }) => Promise<void>` | 订阅所有事件（message.updated、session.*、file.edited 等） |
| `tool` | `{ [name]: ToolDefinition }` | 注册自定义工具 |
| `dispose` | `() => Promise<void>` | 插件卸载时清理 |
| `chat.message` | `(input, output) => Promise<void>` | 新消息到达时触发 |
| `chat.params` | `(input, output) => Promise<void>` | 修改发往 LLM 的参数（temperature、maxTokens 等） |
| `chat.headers` | `(input, output) => Promise<void>` | 修改发往 LLM 的 HTTP 头（可注入 Authorization） |
| `tool.execute.before` | `(input, output) => Promise<void>` | 工具执行前，可改 args |
| `tool.execute.after` | `(input, output) => Promise<void>` | 工具执行后，可改输出 |
| `tool.definition` | `(input, output) => Promise<void>` | 修改工具定义（description、parameters） |
| `shell.env` | `(input, output) => Promise<void>` | 注入 shell 环境变量 |
| `permission.ask` | `(input, output) => Promise<void>` | 干预权限请求 |
| `command.execute.before` | `(input, output) => Promise<void>` | 命令执行前 |
| `auth` | `AuthHook` | 注册 provider 认证方式（OAuth、API key） |
| `provider` | `ProviderHook` | 注册自定义 provider |
| `experimental.session.compacting` | `(input, output) => Promise<void>` | 自定义 compaction prompt |
| `experimental.chat.messages.transform` | `(input, output) => Promise<void>` | 改消息历史 |
| `experimental.chat.system.transform` | `(input, output) => Promise<void>` | 改 system prompt |
| `experimental.provider.small_model` | `(input, output) => Promise<void>` | 指定 small model |
| `experimental.text.complete` | `(input, output) => Promise<void>` | 文本补全 |

### 4.2 config hook 代码示例

`config` hook 接收完整 `Config` 对象，能读到 `provider`、`model` 等配置。**此 hook 存在于类型定义（`index.d.ts:178`）但官方 plugins 文档未展示**。

```ts
const server: Plugin = async (input, options) => {
  return {
    config: async (config) => {
      // config.provider 是所有 provider 的映射
      const provider = config.provider?.["my-provider"]
      const baseURL = provider?.options?.baseURL
      const apiKey = provider?.options?.apiKey
      // 用这些信息构建 key 池、安装 fetch-patch 等
    },
  }
}
```

### 4.3 event hook 代码示例

```ts
const server: Plugin = async (input, options) => {
  return {
    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = (event as any).properties?.info
        if (info?.tokens) {
          // 累计 token 用量
          console.log(`input=${info.tokens.input} output=${info.tokens.output}`)
        }
      }
    },
  }
}
```

可用的事件类型包括：`message.updated`、`message.removed`、`session.created`、`session.idle`、`session.updated`、`file.edited`、`tool.execute.before`、`tool.execute.after`、`permission.asked`、`shell.env`、`server.connected` 等。

### 4.4 tool hook 代码示例

```ts
import { tool, type Plugin } from "@opencode-ai/plugin"

const server: Plugin = async (input, options) => {
  return {
    tool: {
      my_status: tool({
        description: "查看我的插件状态",
        args: { days: tool.schema.number().optional() },
        async execute(args, context) {
          return `当前状态：${args.days ?? 7} 天`
        },
      }),
    },
  }
}
```

LLM 会自动发现并调用你注册的工具。工具名与内置工具重名时，插件工具优先。

### 4.5 chat.headers hook 代码示例

`chat.headers` 能修改发往 LLM 的 HTTP 头，可用于注入或覆盖 `Authorization`：

```ts
const server: Plugin = async (input, options) => {
  return {
    "chat.headers": async (input, output) => {
      // input.provider 含 provider 信息（apiKey 等）
      // output.headers 可写入自定义头
      output.headers["Authorization"] = `Bearer ${myKey}`
    },
  }
}
```

注意：`chat.headers` 能否覆盖 AI SDK 内部已注入的 `Authorization` 头取决于 opencode 的实现时机，未完全验证。替代方案是用 fetch monkey-patch（见第九章）。

## 五、自定义工具

### 5.1 tool() helper

来源：`tool.d.ts:47-58`

```ts
export declare function tool<Args extends z.ZodRawShape>(input: {
  description: string;
  args: Args;
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>;
}): ToolDefinition;
```

`tool.schema` 就是 `zod`（Z），用 Zod schema 定义参数。`execute` 返回 `string` 或 `{ title?, output, metadata? }`。

### 5.2 ToolContext

来源：`tool.d.ts:2-24`

| 字段 | 类型 | 用途 |
|------|------|------|
| `sessionID` | `string` | 当前会话 ID |
| `messageID` | `string` | 当前消息 ID |
| `agent` | `string` | 当前 agent 名 |
| `directory` | `string` | 当前项目目录（优先于 `process.cwd()`） |
| `worktree` | `string` | worktree 根路径 |
| `abort` | `AbortSignal` | 取消信号 |
| `metadata(input)` | `function` | 设置工具执行的标题和元数据 |
| `ask(input)` | `function` | 请求用户权限 |

### 5.3 完整示例

```ts
import { tool, type Plugin } from "@opencode-ai/plugin"

const server: Plugin = async (input) => {
  return {
    tool: {
      query_stats: tool({
        description: "查询指定日期的用量统计",
        args: {
          date: tool.schema.string().describe("日期 YYYY-MM-DD"),
          verbose: tool.schema.boolean().optional(),
        },
        async execute(args, context) {
          // context.directory 可读项目文件
          // context.metadata({ title: "统计结果" })
          const result = { date: args.date, requests: 42 }
          return {
            title: `${args.date} 统计`,
            output: JSON.stringify(result, null, 2),
            metadata: result,
          }
        },
      }),
    },
  }
}
```

## 六、配置与 options 传递

### 6.1 plugin 字段类型

来源：`index.d.ts:48-50`

```ts
export type Config = Omit<SDKConfig, "plugin"> & {
  plugin?: Array<string | [string, PluginOptions]>;
};
```

`plugin` 数组的每个元素可以是 `string` 或 `[string, PluginOptions]`。

### 6.2 两种形式对比

| 写法 | 形式 | options | 插件函数收到 |
|------|------|---------|-------------|
| `"pkg-name"` | 字符串 | 无 | `options = undefined` |
| `"pkg@spec"` | 字符串（带版本/git/file） | 无 | `options = undefined` |
| `["pkg", {opts}]` | tuple | 有 | `options = {opts}` |

### 6.3 options 传递机制

tuple 形式的第二个元素直接作为 `Plugin` 函数的第二个参数传入：

```jsonc
{
  "plugin": [
    ["my-plugin", { "foo": "bar", "count": 3 }]
  ]
}
```

插件函数中：

```ts
const server: Plugin = async (input, options) => {
  // options = { foo: "bar", count: 3 }
  const foo = options?.foo        // "bar"
  const count = options?.count    // 3
}
```

字符串形式不传 options，插件函数的 `options` 为 `undefined`。如果你的插件需要配置，要么用 tuple 形式，要么从 `input.client.config.get()` 读配置（见第八章），要么从环境变量读。

## 七、依赖管理

### 7.1 本地插件用外部包

本地插件（plugins/ 目录下的文件）要用外部 npm 包时，在 config 目录放 `package.json`：

`~/.config/opencode/package.json`：

```json
{
  "dependencies": {
    "shescape": "^2.1.0"
  }
}
```

opencode 启动时跑 `bun install` 安装这些依赖。插件文件中即可 `import { escape } from "shescape"`。

### 7.2 @opencode-ai/plugin 的角色

`@opencode-ai/plugin` 提供 `Plugin`、`PluginModule`、`tool` 等类型和工具函数。关键认知：

- **运行时由 opencode 提供**：opencode 自身的 `node_modules` 里已有 `@opencode-ai/plugin`（如 `~/.config/opencode/node_modules/@opencode-ai/plugin`），插件 `import` 时由 Node/Bun 模块解析向上找到它
- **插件本地只需 devDependencies**：开发时需要类型定义做 `tsc --noEmit`，但运行时不依赖插件自己的 `node_modules`
- **官方文档只用类型导入**：`import type { Plugin } from "@opencode-ai/plugin"`（type-only）

因此插件 `package.json` 中应把 `@opencode-ai/plugin` 放在 `devDependencies`，不要放在 `dependencies`（见第十章 @local 踩坑）。

### 7.3 bun install 机制

opencode 启动时在多个目录跑 `bun install`：

- `~/.cache/opencode/` — 安装 cache package.json 中的 npm 插件（字符串形式）
- `~/.config/opencode/` — 安装用户 package.json 中的依赖（含 `file:` 依赖，供 tuple 形式插件和本地插件使用）
- `<project>/.opencode/` — 项目级依赖

## 八、SDK Client API

插件通过 `input.client`（`createOpencodeClient` 返回值）可调用 opencode 的全部 server API。来源：[opencode.ai/docs/sdk](https://opencode.ai/docs/sdk/)。

### 8.1 命名空间一览

| 命名空间 | 关键方法 | 用途 |
|----------|---------|------|
| `client.config` | `config.get()`、`config.providers()` | 读 opencode 配置、列 provider 和默认 model |
| `client.session` | `session.list/get/create/prompt/messages/...` | 会话管理（创建、发消息、列消息等） |
| `client.app` | `app.log()`、`app.agents()` | 写结构化日志、列 agent |
| `client.project` | `project.list()`、`project.current()` | 项目信息 |
| `client.path` | `path.get()` | 当前路径信息 |
| `client.find` | `find.text()`、`find.files()`、`find.symbols()` | 搜文件内容/文件名/符号 |
| `client.file` | `file.read()`、`file.status()` | 读文件、查文件状态 |
| `client.tui` | `tui.appendPrompt()`、`tui.showToast()`、`tui.submitPrompt()` | 控制 TUI（追加文本、弹 toast、提交 prompt） |
| `client.auth` | `auth.set()` | 设置认证凭据 |
| `client.event` | `event.subscribe()` | SSE 事件流（实时监听） |
| `client.global` | `global.health()` | 健康检查、版本 |

### 8.2 实用示例

读配置（不需要 options 参数也能拿到 provider 信息）：

```ts
const server: Plugin = async (input) => {
  const config = await input.client.config.get()
  // config.data.provider 含所有 provider
  // 可替代 tuple options 读 provider 列表
}
```

写结构化日志（替代 `console.log`，会被 opencode 捕获）：

```ts
await input.client.app.log({
  body: { service: "my-plugin", level: "info", message: "已初始化" },
})
```

## 九、实战：写一个 key 轮询插件

本章用一个迷你版 key 轮询插件串联前八章。以下为教学简化版（仅替换 Authorization 头，不含 URL 替换、熔断 passthrough 等完整功能），完整实现见 [opencode-round-robin](https://github.com/bytesifter/opencode-round-robin) 项目的 `src/`。

### 9.1 目标

同一 provider 有多个 API key，每次请求随机选一个，分散负载。

### 9.2 用 config hook 读 provider 构建 key 池

来源：`src/config.ts:50-96`（简化）

```ts
const server: Plugin = async (input, options) => {
  return {
    config: async (config) => {
      // options.providers 是账号名列表，如 ["account1", "account2"]
      const providers = options?.providers as string[]
      const keys: string[] = []
      for (const name of providers) {
        const p = config.provider?.[name]
        const baseURL = p?.options?.baseURL
        const apiKey = p?.options?.apiKey
        if (baseURL && apiKey) keys.push(apiKey)
      }
      // 按 baseURL 分组，构建 key 池...
      // 安装 fetch-patch（见下）
      patchFetch(keys)
    },
  }
}
```

这里用 `config` hook 而非 `options` 传 key，因为用户已在 provider 配置里写全 `baseURL`+`apiKey`，在 options 里再写一遍是重复劳动。

### 9.3 用 fetch-patch 注入 Authorization

来源：`src/fetch-patch.ts:28-58`（简化）

```ts
function patchFetch(keys: string[]) {
  const origFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url
    // 仅拦截匹配 pool 的请求
    if (!url.startsWith("https://api.example.com/coding/v3")) {
      return origFetch(input, init)
    }
    // 随机选 key
    const key = keys[Math.floor(Math.random() * keys.length)]
    const headers = new Headers(init?.headers)
    headers.set("Authorization", `Bearer ${key}`)
    return origFetch(input, { ...init, headers })
  }
}
```

fetch monkey-patch 覆盖所有 HTTP 请求（含子 agent、compact、small model），轮询更彻底。替代方案是 `chat.headers` hook（更干净，但能否覆盖 AI SDK 内部注入的 Authorization 未完全验证）。

### 9.4 用 event hook 记统计

来源：`src/index.ts:55-65`（简化）

```ts
const server: Plugin = async (input) => {
  return {
    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = (event as any).properties?.info
        if (info?.tokens) {
          // 累计到内存，定时刷盘
          stats.add(info.tokens.input, info.tokens.output)
        }
      }
    },
  }
}
```

### 9.5 用 tool 注册状态查看

来源：`src/index.ts:66-75`（简化）

```ts
const server: Plugin = async (input) => {
  return {
    tool: {
      roundrobin_stats: tool({
        description: "查看 key 轮询按天统计",
        args: { days: tool.schema.number().optional() },
        async execute(args) {
          return renderChart(stats, args.days ?? 7)
        },
      }),
    },
  }
}
```

用户对 LLM 说"看轮询统计"，LLM 自动调用此工具返回 ASCII 图表。

### 9.6 组合起来

完整插件把这四个 hook 组合在一个 `Hooks` 对象里返回：

```ts
const server: Plugin = async (input, options) => {
  return {
    config: async (config) => { /* 构建 pool + 装 fetch-patch */ },
    event: async ({ event }) => { /* 累计统计 */ },
    tool: { roundrobin_stats: tool({ /* ... */ }) },
  }
}
```

这就是 opencode-round-robin 的核心结构。完整实现（含 cooldown、日志、图表）见 `src/index.ts`。

## 十、踩坑与调试

### 10.1 @local 安装问题

#### 现象

tuple 形式插件（`["opencode-round-robin", {opts}]` + config 目录 `file:` 依赖）配置后，插件始终不加载。`opencode.log` 里出现大量 WARN：

```text
timestamp=... level=WARN message="background dependency install failed"
  dir="C:\Users\nixgn\.config\opencode"
  error="NpmInstallFailedError (cause: @opencode-ai/plugin:
    No matching version found for @opencode-ai/plugin@local.)"
```

#### 根因

opencode 在 `~/.config/opencode/` 跑 `bun install` 时，**无条件注入** `@opencode-ai/plugin: "local"` 到安装清单（表示"运行时由我提供"）。但 Bun 不认识 `local` 这个版本 specifier，从 npm registry 找不到 `@opencode-ai/plugin@local`，导致整个 install 失败。

tuple 形式插件依赖这个 install 把包链接进 `~/.config/opencode/node_modules/`。install 失败 → 包不在 node_modules → 插件不加载。

关键：这个 `@local` 注入**与用户 `package.json` 声明无关**——即使移除 `@opencode-ai/plugin`，opencode 仍会注入。它出现在所有 install 目录（config 目录 + 每个项目的 `.opencode` 目录）。

字符串形式插件（如 superpowers）不受影响——它们装进 cache（`~/.cache/opencode/`），cache 的 package.json 不含 `@opencode-ai/plugin`，install 正常。

#### 三种尝试与结论

| 尝试 | 做法 | 结果 |
|------|------|------|
| 挪 devDeps | 把 `@opencode-ai/plugin` 从 `dependencies` 移到 `devDependencies` | 无效，错误不变（@local 不来自项目 package.json） |
| junction | 手动创建 `node_modules/opencode-round-robin` 链接到项目目录 | 无效，opencode 在 install 失败后跳过 tuple 插件加载（不看物理存在，看 install 结果） |
| 移除 config 依赖 | 从 `~/.config/opencode/package.json` 删 `@opencode-ai/plugin` | 无效，@local 无条件注入 |

#### 可复现排查步骤

你的插件配了却不工作？按这三步排查：

**第一步：查 opencode.log 有无 install 失败**

```bash
findstr /c:"background dependency install failed" "%USERPROFILE%\.local\share\opencode\log\opencode.log"
```

如果看到 `@opencode-ai/plugin@local` 错误，就是这个问题。

**第二步：查 cache package.json 确认安装方式**

```bash
type "%USERPROFILE%\.cache\opencode\package.json"
```

如果你的插件不在里面，说明你用的是 tuple 形式（不进 cache）。

**第三步：手动 bun install 对照**

```bash
cd "%USERPROFILE%\.config\opencode"
bun install
```

手动 `bun install` 不会注入 `@local`（这是 opencode 的行为），如果手动 install 成功而 opencode 启动时报 `@local` 错误，就确认是 opencode 的注入问题。

#### 当前状态与方向

截至 2026-07，此问题在 oh-my-opencode 3.15.3 / opencode desktop 上**未解决**。已知方向：

- 方向 A：在 config 目录 `package.json` 加 `overrides`（`"@opencode-ai/plugin": "1.4.7"`），强制 Bun 用指定版本——待验证 opencode 是否保留 overrides 字段
- 方向 B：改用字符串形式（`"opencode-round-robin@file:D:/..."`），走 cache 安装绕开 config 目录 install——代价是丢失 options 传参，需改插件从 `client.config.get()` 读配置
- 方向 C：向 opencode 报 bug（[github.com/anomalyco/opencode/issues](https://github.com/anomalyco/opencode/issues)）

### 10.2 通用调试技巧

- **判断插件有没有加载**：插件注册的 `tool` 不会出现在 LLM 可用工具里 → 插件没加载
- **查 opencode.log**：`~/.local/share/opencode/log/opencode.log`，搜 `WARN`/`ERROR`
- **用 `client.app.log()` 打日志**：替代 `console.log`，opencode 会捕获并写入 opencode.log
- **asar 挖掘**：opencode desktop 的逻辑在 `app.asar`（`~/.local/Programs/@opencode-aidesktop/resources/app.asar`），可用 PowerShell 读字节搜索字符串

## 十一、资源

### 11.1 官方文档

- [Plugins](https://opencode.ai/docs/plugins) — 插件加载、创建、示例（简化版）
- [Config](https://opencode.ai/docs/config/) — 配置文件格式、位置、plugin 字段
- [SDK](https://opencode.ai/docs/sdk/) — Client API 全览
- [Ecosystem](https://opencode.ai/docs/ecosystem/) — 社区插件和项目

### 11.2 类型定义

- `@opencode-ai/plugin` — `node_modules/@opencode-ai/plugin/dist/index.d.ts`（Plugin、PluginInput、PluginModule、Hooks、Config）
- `@opencode-ai/plugin` — `dist/tool.d.ts`（tool helper、ToolContext、ToolDefinition）
- 配置 schema — [opencode.ai/config.json](https://opencode.ai/config.json)

### 11.3 社区插件示例

- `opencode-anthropic-auth` — provider 认证插件，`@opencode-ai/plugin` 在 devDependencies
- `opencode-autognosis` — 含 `@opencode-ai/plugin` 和 `@opencode-ai/sdk` 在 devDependencies
- `opencode-round-robin` — 本文的实战案例，组合 config/event/tool hooks
- `superpowers` — Claude Code 插件格式（`@opencode-ai/plugin` 零依赖，走 git URL 安装）

这两个同类插件（anthropic-auth、autognosis）都把 `@opencode-ai/plugin` 放在 `devDependencies`，runtime `dependencies` 为空或仅含第三方库——这是编写 opencode server 插件的最佳实践。

### 11.4 本文项目

完整代码和文档：[https://github.com/bytesifter/opencode-round-robin](https://github.com/bytesifter/opencode-round-robin)

如果对你有帮助，欢迎 Star 支持。

## 十二、v2 迁移要点

opencode v2（≥ 2.0，含桌面版 GUI）重写了插件模型。**V1 插件实现不会在 v2 运行**——移动文件或改配置条目不够，必须迁移插件代码。本文前述内容均为 V1 模型，以下列出关键差异：

### 12.1 配置形态：`plugin` → `plugins`

```jsonc
// V1(不再加载)
"plugin": [
  ["file:///path/to/plugin", { "providers": ["a"] }]
]

// V2
"plugins": [
  {
    "package": "file:///path/to/plugin",
    "options": { "providers": ["a"] }
  }
]
```

`plugins` 数组接受：npm 包名 / 路径字符串（`file:///...`、`/abs/path`、`./rel`）/ `{package, options}` 对象。V1 的 `["file:///路径", options]` 元组在 v2 下会被静默丢弃。

### 12.2 导出格式：`PluginModule {id, server}` → `Plugin.define({id, setup})`

```ts
// V1
import { tool, type Plugin, type PluginModule } from "@opencode-ai/plugin"
const server: Plugin = async (input, options) => ({ /* hooks */ })
export default { id: "my-plugin", server } satisfies PluginModule

// V2
import { Plugin } from "@opencode/plugin"
export default Plugin.define({
  id: "my-plugin",
  async setup(ctx) {
    // ctx.options 取配置;返回 cleanup 在卸载时执行
  },
})
```

运行时依赖从 `@opencode-ai/plugin`（V1）换成 `@opencode/plugin`（V2），均放 `devDependencies`。

### 12.3 API 模型：hooks 对象 → domain API

| 能力 | V1 | V2 |
|------|----|----|
| 读配置 options | `server(input, options)` 第二参 | `ctx.options` |
| 注册工具 | `tool: { name: tool({...}) }`（zod） | `ctx.tool.transform`（JSON Schema 入参） |
| 监听事件 | `event: async ({event}) => {}` | `ctx.event.subscribe()` 异步迭代 |
| 改 provider/模型 | `config` / `provider` hook | `ctx.provider.transform` / `ctx.model.transform` |
| 会话操作 | `input.client.session.*` | `ctx.session.*` |
| 持久化 | 自管文件 | `ctx.storage` |

### 12.4 请求拦截：fetch monkey-patch → `ctx.session.hook`

V1 靠 `globalThis.fetch = ...` 全局替换拦截 LLM 请求。v2 提供一等钩子：

```ts
await ctx.session.hook("http.request", (event) => {
  event.request.headers.set("Authorization", "Bearer xxx")
  // event.sessionID / event.model / event.kind 可直接用
})
await ctx.session.hook("http.response", (event) => {
  if (event.response.status === 429) { /* 熔断 */ }
})
```

钩子事件自带 `sessionID`（V1 靠 `X-Session-Id` 头的做法不再需要）；请求 body 为一次性流，读取前先 `clone()`。

### 12.5 其他

- 本地插件加载：`.opencode/plugins/`（项目）或 `~/.config/opencode/plugins/`（全局）自动加载
- 文章 §10.1 的 `@local` 安装问题、§10.2 的 asar 挖掘路径均属 V1/旧桌面版（`@opencode-aidesktop`），v2 桌面版为 `@opencodedesktop`
- 完整迁移指南见 [官方 v2 迁移文档](https://opencode.ai/v2/docs/build/plugins/migrate-v1)；本项目实战迁移见 [fix-plan-mate-v2-migration](../../openspec/changes/fix-plan-mate-v2-migration/) 与 [docs/technical](../../docs/technical/plan-stats/README.md)