# 安装与配置

## 前置依赖

- [Bun](https://bun.sh)（构建与测试）
- [arkcli](https://www.npmjs.com/package/@volcengine/ark-cli)（仅 `plan_stats` 套餐配额统计需要，可选）

## 安装

```bash
git clone https://github.com/bytesifter/opencode-plan-mate.git
cd opencode-plan-mate
bun install
bun run build
```

> **版本要求**：需要 **opencode v2**（CLI ≥ 2.0，或桌面版 GUI 内置 v2 后台服务）。v1.x 插件模型已废弃，本插件在 v1 下不会被加载。

在 `~/.config/opencode/opencode.jsonc`（Windows 为 `%USERPROFILE%\.config\opencode\opencode.jsonc`）的 `plugins` 数组中用 `{"package": "file:///...", "options": {...}}` 对象指向 clone 路径：

```jsonc
"plugins": [
  { "package": "file:///path/to/opencode-plan-mate", "options": { "providers": ["account-a", "account-b", "account-c"] } }
]
```

Windows 下路径用盘符写法（`file:///` 后接 `D:/...`，斜杠而非反斜杠）：

```jsonc
"plugins": [
  { "package": "file:///D:/code/opencode-plan-mate", "options": { "providers": ["account-a", "account-b", "account-c"] } }
]
```

插件的 `main` 指向 `./dist/index.js`（预构建产物），opencode 通过 `import()` 加载。修改源码后执行 `bun run build` 重新构建。

> v1 的 `plugin` 数组 + `["file:///路径", options]` 元组形态在 v2 下**不会被加载**（静默丢弃），必须使用上面的 v2 `plugins` 对象形态。

## 配置项

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `providers` | `string[]` | 是 | - | 参与轮询的 provider 名（账号名）列表 |
| `cooldownMs` | `number` | 否 | `60000` | 请求太快 429 后 key 冷却时长（毫秒），全局 |
| `quotaCooldownMs` | `number` | 否 | `3600000` | 配额耗尽 429 或余额不足 402 时 key 冷却时长（毫秒） |
| `statsDir` | `string` | 否 | 见下 | 统计目录（按日 JSONL 文件） |
| `logDir` | `string` | 否 | 见下 | 日志目录（按日轮转，默认启用） |
| `logPath` | `string` | 否 | - | 日志文件路径（强制单文件模式，禁用轮转） |
| `planStats` | `object` | 否 | - | 套餐配额统计配置：`accounts`（显示名 → 独立 arkcli HOME 目录），见 [套餐配额统计](../user-guide/plan-stats.md) |

`logDir` / `statsDir` 可指向**已存在**的目录：插件以幂等方式准备目录，既存目录不会导致加载失败（Windows 下尤其重要，见下方说明）。

默认产物路径（`~/.local/share/opencode/`，Windows 为 `%USERPROFILE%\.local\share\opencode\`）：

- 统计：`~/.local/share/opencode/plan-mate-stats/YYYY-MM-DD.jsonl`（按日文件，追加式增量记录；Windows：`%USERPROFILE%\.local\share\opencode\plan-mate-stats\YYYY-MM-DD.jsonl`）
- 日志：`~/.local/share/opencode/plan-mate-YYYY-MM-DD.log`（按日轮转；Windows：`%USERPROFILE%\.local\share\opencode\plan-mate-YYYY-MM-DD.log`）

统计为**追加式按日 JSONL**：每个进程每 60 秒把自上次刷盘以来的增量追加写入当天文件，追加原子、多进程并发不覆盖。`plan_mate_stats` 工具聚合磁盘上所有进程的记录，跨进程数据完整可见。崩溃最多丢 1 分钟增量。

日志模式优先级：`logPath > logDir > 默认（轮转）`。配置 `logPath` 时强制单文件模式并忽略 `logDir`；不配 `logPath` 时启用按日轮转，目录为 `logDir` 或默认路径。

## 配置示例

以 3 个同端点账号为例，先在 `provider` 里按「每个账号一个 provider」配好：

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
  "plugins": [
    {
      "package": "file:///path/to/opencode-plan-mate",
      "options": {
        "providers": ["account-a", "account-b", "account-c"],
        "cooldownMs": 60000,
        "quotaCooldownMs": 3600000
      }
    }
  ]
}
```

`model` 指向的 provider 决定 opencode 发出的初始请求 URL，插件在 `ctx.session.hook("http.request")` 钩子中用 `pool.findBaseURL()` 识别该请求归属的接入点，然后在该接入点下按模型分组随机选 provider，替换为选中 provider 的 key（同接入点 baseURL 不变，URL 不变）。不跨接入点轮询。

## 轮询规则

- 插件 options（`providers` 等）来自 `plugins` 数组 `{package, options}` 对象的 `options`，经 `ctx.options` 传入 `setup(ctx)`
- 插件读取 `opencode.jsonc`（全局 + 所在位置配置，项目级覆盖全局）中 `providers` 列表对应的 provider 定义（v2 的 provider 元数据不含 apiKey，apiKey 从配置文件读取），收集所有 key + baseURL 形成扁平列表
- 按「接入点 + 模型」分组：请求从哪个 baseURL 发出，就在该 baseURL 下、支持该模型（解析请求 body 的 `model` 字段）的 provider 中随机选一个，替换 Authorization 头（同接入点下 URL 不变，仅换 key；不跨接入点轮询）
- 请求 body 不可解析或模型在该接入点无匹配时，退化为在该接入点内所有非熔断 provider 中随机选
- 同接入点分组全部熔断（429/402）时 passthrough 回退到 opencode 原生请求，不跨接入点兜底
- 429/402 熔断判定在 `ctx.session.hook("http.response")` 钩子中完成（429 读响应体区分配额耗尽/请求太快；402 无条件长熔断）
- key 去重（相同 key 只保留第一个）
