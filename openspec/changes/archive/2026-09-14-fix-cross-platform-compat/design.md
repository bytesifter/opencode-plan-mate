## Context

动机见 proposal.md - Why。当前相关实现：

- `src/logger.ts:31`、`src/stats.ts:59`：各自在构造函数里 `mkdirSync(dir, { recursive: true })`。`Logger` 在 `server()` 加载期即被构造（`src/index.ts:40`），所以目录准备一旦抛错，整个插件加载失败。
- `src/quota.ts:50-67`：`volcArkcliAdapter.fetch` 通过 `spawn` 的 `env` 传 `{ ...CALLER_ENV, HOME: home }`，隔离身份仅靠 `HOME`。
- `src/config.ts:64-68`：`expandHome` 只识别 `~` 与 `~/`。
- `package.json` `main` 指向 `./dist/index.js`，opencode 经 `file://` 加载的是构建产物。

约束：Linux 行为必须保持不变；配置 schema（`planStats.accounts`）不变；不引入新运行时依赖（保持自包含构建）。

## Goals / Non-Goals

**Goals:**

- 插件在 `logDir` / `statsDir` 已存在时在 Windows 与 Linux 上都能成功加载
- `planStats.accounts` 的每账号隔离在两个平台都真正生效，且配置写法不变
- `~` 前缀路径在 Windows 习惯写法下也能展开
- 修复在 opencode 运行时真实生效（重建 `dist`）

**Non-Goals:**

- 不自动化 arkcli 的 SSO 登录 / profile 创建（用户手工一次性操作）
- 不改变 `SpawnExecutor` 抽象与测试注入方式
- 不改 `defaultSpawn` 的命令解析（opencode 用 Bun 运行时，实测 `spawn("arkcli")` 可解析 `.cmd` shim；纯 Node on Windows 的差异不在本 change 范围）
- 不修改 `planStats.accounts` 的配置 schema

## Decisions

### D1: 幂等目录准备 —— `existsSync` 守卫（而非 try/catch 或懒加载）

新增/复用一个「准备目录」语义：目标目录已存在则跳过 `mkdirSync`，否则创建。

备选：

- **try/catch 忽略 `EEXIST`**：不依赖 `existsSync`，但仍依赖运行时"对已存在目录抛 EEXIST"这一非标准行为；且标准 Node 下 `recursive` 本不抛，捕获分支形同虚设。否决。
- **懒加载（把 mkdir 移到首次 write/flush）**：加载期零 IO，理论上最稳，但改动面更大（Logger/StatsCollector 生命周期），且会把"目录不可用"问题推迟到写盘时。作为设计原则记录（加载期不应因日志/统计目录失败而失败），本 change 取最小实现。

`existsSync` 守卫的 TOCTOU 竞态在此场景无实质影响（目录只会被本插件/同一用户创建）。

### D2: 账号隔离环境变量 —— 同时注入 `HOME` 与 `USERPROFILE`

`volcArkcliAdapter.fetch` 的 `env` 由 `{ HOME: home }` 改为 `{ HOME: home, USERPROFILE: home }`。

依据（实测）：Windows 上 arkcli（Go 二进制）只认 `USERPROFILE`、忽略 `HOME`；POSIX 相反。同时设置两者可**无需 `process.platform` 分支**地覆盖两平台，非目标平台的变量被忽略，无副作用。

备选：

- **按 `process.platform` 分支**：更"显式"，但多一个平台判断分支与测试路径；且 POSIX 上多设一个无用变量同样无害。否决。
- **per-account 配置项指定环境变量名**：schema 变复杂，且没有额外收益。否决。
- **arkcli 专用配置目录环境变量**：排查 arkcli 二进制字符串，无 `ARKCLI_HOME` / `ARKCLI_CONFIG*` 之类入口。不可行。

### D3: `~` 展开兼容 `~\`

`expandHome` 增加对 `~\` 前缀的识别（与 `~/` 等同处理，`join(homedir(), rest)`）。`join` 在 Windows 上会规范化分隔符，无需手工替换 `\`。

### D4: 重建 `dist` 作为本 change 的收口必做项

运行时按 `main: ./dist/index.js` 加载，源码修复不自动生效。任务中显式包含 `bun run build` + 产物校验（对照 `fix-plan-stats-hide-errors` 的教训）。

## Risks / Trade-offs

- **`USERPROFILE` 同时被设置**可能影响 arkcli 其余基于 home 的行为（如更新缓存路径）→ 仅作用于该次短命子进程，且正是期望的隔离效果；可接受。
- **`HOME` 在 Windows 上被设置但被忽略** → 无副作用；两变量并存是刻意的兼容写法。
- **`existsSync` 与 `mkdirSync` 之间极小的竞态** → 目录由同用户/同插件创建，实际不可能冲突。
- **仅在 Bun 运行时验证过 mkdir 的 EEXIST 复现** → 修复 `existsSync` 守卫是行为无关的幂等化，对 Node/Linux 同样安全；验收覆盖两平台测试。
- **`dist` 未重建导致"测试通过但运行时仍坏"** → 见 D4，纳入验收而非仅依赖单测。

## Migration Plan

1. 实现源码修复（logger / stats / quota / config）
2. `bun test` + `bunx tsc --noEmit`
3. `bun run build` 重建 `dist/index.js`，校验产物含修复
4. 更新文档（Windows 安装/登录说明）
5. 回滚：纯本地改动，`git revert` 即可；无数据迁移、无外部接口变更
