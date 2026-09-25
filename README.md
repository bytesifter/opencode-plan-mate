# opencode-plan-mate

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

opencode 插件：对多个账号 API key 做**随机轮询**，附带按天实际用量统计与结构化请求日志，并可查看各账号 Coding Plan **官方配额**。

## 特性

- **随机轮询**：按「接入点 + 模型」分组，同接入点内随机换 key，不跨接入点
- **429/402 熔断**：区分配额耗尽与请求太快，时长可配，全部熔断时回退 opencode 原生请求
- **实际用量统计**：按天累计请求数与 token（`plan_mate_stats` 工具，ASCII 柱状图）
- **官方配额查看**：各账号 Coding Plan 配额 percent + 重置时间（`plan_stats` 工具）
- **结构化日志**：按日轮转，key 脱敏，含业务上下文与耗时
- **自包含构建**：`dist/index.js` 内联全部依赖（含 `jsonc-parser`），运行时零依赖分发，仅需 opencode v2 提供插件运行时

## 快速开始

> **版本要求**：本插件需 **opencode v2**（含桌面版 GUI，内置 v2.0.x 后台服务）。v1.x 的插件模型已废弃，v1 下插件不会被加载；V1 插件 API 说明见 `articles/opencode-plugin-dev-guide.md`（历史参考）。

1. 克隆并构建

```bash
git clone https://github.com/bytesifter/opencode-plan-mate.git
cd opencode-plan-mate
bun install
bun run build
```

2. 在 `~/.config/opencode/opencode.jsonc`（Windows 为 `%USERPROFILE%\.config\opencode\opencode.jsonc`）的 `plugins` 数组指向插件，声明参与轮询的账号

```jsonc
"plugins": [
  {
    "package": "file:///path/to/opencode-plan-mate",
    "options": { "providers": ["account-a", "account-b", "account-c"] }
  }
]
```

3. 重启 opencode 即生效。对 LLM 说「看轮询统计」或「看套餐配额」调用对应工具。

完整安装与配置见 [安装与配置](docs/getting-started/installation.md)。

### 一键登录各账号（plan_stats 前置）

`plan_stats` 需要每个账号在独立 HOME 下完成 SSO 登录。仓库自带脚本自动读取 `planStats.accounts`（兼容 v2 `plugins` 对象形态与 v1 `plugin` 元组形态）并全量重登：

POSIX（Linux / macOS）：

```bash
bun scripts/login-arkcli-accounts.ts                  # 默认读 ./opencode.jsonc
bun scripts/login-arkcli-accounts.ts --config ~/.config/opencode/opencode.jsonc
bun scripts/login-arkcli-accounts.ts --dry-run        # 只打印清单,不登录
```

Windows（PowerShell）——脚本不展开 `--config` 路径的 `~`，需用 `$env:USERPROFILE` 显式展开：

```powershell
bun scripts/login-arkcli-accounts.ts                        # 默认读 ./opencode.jsonc
bun scripts/login-arkcli-accounts.ts --config "$env:USERPROFILE\.config\opencode\opencode.jsonc"
bun scripts/login-arkcli-accounts.ts --dry-run              # 只打印清单,不登录
```

交互流程：脚本逐账号打开浏览器 → 你完成 SSO 授权后把 base64 授权码粘贴回终端 → 脚本自动完成登录、profile 兜底与 `usage plan` 验证。**注意脚本每次会清空所有账号 HOME 重新登录。** 详见 [套餐配额统计](docs/user-guide/plan-stats.md)。

## 工具速查

| 工具 | 说给 LLM | 返回 |
|------|---------|------|
| `plan_mate_stats` | 「看轮询统计」 | 近 N 天按账号的请求/token ASCII 柱状图 |
| `plan_stats` | 「看套餐配额」 | 各账号 Coding Plan 官方配额 percent + 重置时间 |

- 轮询与用量统计：[轮询与用量统计](docs/user-guide/plan-mate-stats.md)
- 套餐配额统计：[套餐配额统计](docs/user-guide/plan-stats.md)

## 文档导航

- 入门：`docs/getting-started/installation.md`（安装、配置、轮询规则）
- 用户指南：`docs/user-guide/plan-mate-stats.md`、`docs/user-guide/plan-stats.md`
- 技术方案：`docs/technical/plan-stats/README.md`

## 开发

```bash
bun install          # 安装依赖
bun run build        # 构建自包含产物到 dist/index.js
bun test             # 运行测试
bun x tsc --noEmit   # 类型检查
```

技术栈：Bun + TypeScript；`bun build` 打包为 Node.js ESM（`--target node`），`main` 指向 `./dist/index.js`。

`scripts/login-arkcli-accounts.ts` 是独立工具脚本（不参与 `dist` 打包），依赖 `jsonc-parser`（devDependency）。

## 贡献

欢迎提 Issue 或 Pull Request。

## 许可证

[Apache License 2.0](LICENSE)。
