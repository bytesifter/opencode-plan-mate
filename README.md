# opencode-round-robin

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

opencode 插件:对多个账号 API key 做**随机轮询**,附带按天用量统计与结构化请求日志。

## 功能

- **随机轮询**:声明 `providers`(账号名列表),插件通过 `config` hook 读 opencode 的 provider 配置,收集所有 key + baseURL,每次请求随机选一个 provider,同时替换 Authorization 头和请求 URL--**按接入点(baseURL)+ 模型分组轮询,同接入点内随机,不跨接入点**
- **429/402 熔断**:区分两种 429--配额耗尽默认熔断 1 小时,请求太快默认熔断 1 分钟,时长均可配;余额不足 402(Insufficient Balance)按配额耗尽熔断 1 小时;全部熔断时 passthrough 回退到 opencode 原生请求
- **用量统计**:通过 `event` hook 按天累计请求数与 token 消耗(input/output/reasoning/cache),内存累积 60 秒刷盘到 JSON
- **图表查看**:注册 `roundrobin_stats` 工具,返回按天 ASCII 柱状图
- **结构化日志**:按日轮转,含日志级别(INFO/WARN/ERROR)、业务上下文(session/model/provider/mode/agent/duration)、请求耗时;key 脱敏(仅记序号与末 4 位)
- **自包含构建**:`dist/index.js` 内联 `@opencode-ai/plugin` 的 `tool()` 函数及 `zod`,运行时无需 `node_modules` 中存在 `@opencode-ai/plugin`,零依赖分发

## 安装

```bash
git clone https://github.com/bytesifter/opencode-round-robin.git
cd opencode-round-robin
bun install
bun run build
```

在 `~/.config/opencode/opencode.jsonc` 的 `plugin` 数组中用 `file:///` 指向你 clone 的路径:

```jsonc
"plugin": [
  ["file:///path/to/opencode-round-robin", { "providers": ["account-a", "account-b", "account-c"] }]
]
```

> 插件的 `main` 指向 `./dist/index.js`(预构建产物),opencode 通过 `import()` 加载。如需修改源码,执行 `bun run build` 重新构建。

## 配置

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `providers` | `string[]` | 是 | - | 参与轮询的 provider 名(账号名)列表 |
| `cooldownMs` | `number` | 否 | `60000` | 请求太快 429 后 key 冷却时长(毫秒),全局 |
| `quotaCooldownMs` | `number` | 否 | `3600000` | 配额耗尽 429 或余额不足 402 时 key 冷却时长(毫秒) |
| `statsPath` | `string` | 否 | 见下 | 统计文件路径 |
| `logDir` | `string` | 否 | 见下 | 日志目录(按日轮转,默认启用) |
| `logPath` | `string` | 否 | - | 日志文件路径(强制单文件模式,禁用轮转) |

默认产物路径(`~/.local/share/opencode/`):
- 统计:`~/.local/share/opencode/round-robin-stats.json`
- 日志:`~/.local/share/opencode/round-robin-YYYY-MM-DD.log`(按日轮转)

日志模式优先级:`logPath > logDir > 默认(轮转)`。配置 `logPath` 时强制单文件模式并忽略 `logDir`;不配 `logPath` 时启用按日轮转,目录为 `logDir` 或默认路径。

规则:
- 插件通过 `config` hook 读取 `opencode.jsonc` 中 `providers` 列表对应的 provider,收集所有 key + baseURL 形成扁平列表
- 按"接入点 + 模型"分组:请求从哪个 baseURL 发出,就在该 baseURL 下、支持该模型(解析请求 body 的 `model` 字段)的 provider 中随机选一个,替换 Authorization 头和请求 URL(同接入点下 URL 不变,仅换 key;不跨接入点轮询)
- 请求 body 不可解析或模型在该接入点无匹配时,退化为在该接入点内所有非熔断 provider 中随机选
- 同接入点分组全部熔断(429/402)时 passthrough 回退到 opencode 原生请求,不跨接入点兜底
- key 去重(相同 key 只保留第一个)

## 配置示例

以 3 个同端点账号为例。先在 `provider` 里按"每个账号一个 provider"配好:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "account-a/glm-5.2",
  "provider": {
    "account-a": {
      "name": "account-a",
      "npm": "@ai-sdk/openai-compatible",
      "models": { "glm-5.2": { "name": "glm-5.2" } },
      "options": {
        "apiKey": "ark-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-22898",
        "baseURL": "https://ark.cn-beijing.volces.com/api/coding/v3"
      }
    },
    "account-b": {
      "name": "account-b",
      "npm": "@ai-sdk/openai-compatible",
      "models": { "glm-5.2": { "name": "glm-5.2" } },
      "options": {
        "apiKey": "ark-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-32a5b",
        "baseURL": "https://ark.cn-beijing.volces.com/api/coding/v3"
      }
    },
    "account-c": {
      "name": "account-c",
      "npm": "@ai-sdk/openai-compatible",
      "models": { "glm-5.2": { "name": "glm-5.2" } },
      "options": {
        "apiKey": "ark-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-48199",
        "baseURL": "https://ark.cn-beijing.volces.com/api/coding/v3"
      }
    }
  },
  "plugin": [
    ["file:///path/to/opencode-round-robin", {
      "providers": ["account-a", "account-b", "account-c"],
      "cooldownMs": 60000,
      "quotaCooldownMs": 3600000
    }]
  ]
}
```

`model` 指向的 provider 决定 opencode 发出的初始请求 URL,插件拦截 fetch 后用 `pool.findBaseURL()` 识别该请求归属的接入点,然后在该接入点下按模型分组随机选 provider,替换为选中 provider 的 key(baseURL 相同,URL 不变)。不跨接入点轮询。

## 工具用法

对 LLM 说"看轮询统计",LLM 会调用 `roundrobin_stats` 工具,返回近 7 天 ASCII 柱状图:

```
round-robin 近 7 天统计
日期      请求                 token
07-25  ████████████·····    34   ████████████·····   19.7k
07-24  ████████·········    23   ██████············   15.3k
07-23  █████████████████    67   █████████████████   38.3k
...
```

可选参数 `days` 指定天数(如"看近 30 天统计")。

## 日志示例

```
2026-07-26 18:51:40.123 INFO  fetch provider=account-a key=#0(..2898) status=200 duration=342ms
2026-07-26 18:52:08.456 INFO  usage in=4556 out=2182 reasoning=0 cacheR=312384 cacheW=0 cost=0.0021 session=a3f2 model=glm-5.2 provider=account-a mode=code agent=opencode duration=1283ms
2026-07-26 18:53:00.789 WARN  cooldown provider=account-b key=#1(..2a5b) rate-limit 60000ms
2026-07-26 18:54:00.123 WARN  cooldown provider=account-c key=#2(..4819) quota-exhausted 3600000ms
2026-07-26 18:55:00.456 WARN  cooldown provider=account-d key=#3(..1a2c) quota-exhausted 3600000ms
```

- 第一行(fetch 层):用了 account-a 账号的 key#0,HTTP 200,耗时 342ms
- 第二行(event 层):本次消息 token 用量,含 session/model/provider/mode/agent/duration 等业务上下文
- 第三行(请求太快):account-b 被限流,冷却 60 秒
- 第四行(配额耗尽):account-c 配额用完,冷却 1 小时
- 第五行(余额不足):account-d 收到 402 响应,按配额耗尽冷却 1 小时

日志按日轮转,文件名 `round-robin-YYYY-MM-DD.log`。配置 `logPath` 可强制单文件模式(禁用轮转)。

## 开发

```bash
bun install          # 安装依赖
bun run build        # 构建自包含产物到 dist/index.js
bun test             # 运行测试
bun x tsc --noEmit   # 类型检查
```

技术栈:Bun + TypeScript;`bun build` 打包为 Node.js ESM(`--target node`),`main` 指向 `./dist/index.js`。`@opencode-ai/plugin` 在 `devDependencies`(编译期类型),运行时已内联到 `dist/index.js`。

## 贡献

欢迎提 Issue 或 Pull Request。

## 许可证

[Apache License 2.0](LICENSE)。
