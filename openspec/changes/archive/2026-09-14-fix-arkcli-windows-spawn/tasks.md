## 1. Windows 可执行文件解析（src/quota.ts）

- [x] 1.1 新增纯函数 `buildSpawn(platform, cmd, args)`：win32 返回 `{ file: process.env.ComSpec ?? "cmd.exe", args: ["/c", cmd, ...args] }`，其余平台原样 `{ file: cmd, args }`；验证：单测对 `win32`/`linux` 分别断言 file 与 args（见 3.1）
- [x] 1.2 `defaultSpawn` 改用它构造派生参数（env、超时、stdout/stderr 收集逻辑保持不变）；验证：现有 `tests/quota.test.ts` 全绿，且无 `DEP0190` 告警
- [x] 1.3 在 `defaultSpawn` 附近落下注释：账号 home 等动态量 SHALL 走 env 而非 args，避免 `cmd.exe` 转义/注入面；验证：注释存在且与实现一致

## 2. 错误标注细化

- [x] 2.1 `defaultSpawn` 在 `error` 事件透传底层 `err.code`（如 `ENOENT` / `EINVAL`）；`volcArkcliAdapter.fetch` 区分「未安装」（无法定位可执行文件）与「无法启动」（已定位但解析/执行失败）两类文案；验证：单测断言两种 `code` 映射到不同错误串
- [x] 2.2 确认单账号失败仍不阻塞其他账号（`collectPlanQuotas` 错误隔离不变）；验证：既有「单账号失败不阻塞」用例通过

## 3. 单元测试（tests/quota.test.ts）

- [x] 3.1 新增 `buildSpawn` 用例：`win32` → `cmd.exe /c arkcli ...`；`linux`/`darwin` → 裸 `arkcli ...`；验证：`bun test` 该组用例通过
- [x] 3.2 新增「可选集成」用例：仅当本机可定位且能启动 arkcli 时执行 `defaultSpawn("arkcli", ["--version"])` 并断言 `exitCode===0`，否则 skip；验证：有 arkcli 环境通过、无 arkcli 环境 skip 而非 fail

## 4. 文档修正

- [x] 4.1 更新 `docs/user-guide/plan-stats.md` 的 Windows 段：用独立 `$base` 变量拼接账号路径，不再覆盖后用 `USERPROFILE` 再拼下一个；移除冗余 `mkdir`；注明 arkcli 自建 `$HOME/.arkcli`（含父目录）；验证：按示例对两个账号顺序执行不再产生嵌套目录
- [x] 4.2 同步 POSIX 段删除冗余 `mkdir -p` 说明（与 Windows 保持一致）；验证：文档两平台步骤一致、可复制执行

## 5. 验证与构建产物同步

- [x] 5.1 运行 `bun test`，全量通过
- [x] 5.2 运行 `bunx tsc --noEmit`，类型检查通过（改用本地固定版 `node_modules/typescript/lib/tsc.js` 5.9.3 通过；`bunx` 会拉取移除 `baseUrl` 的新版 TS，属预存在的工具链问题）
- [x] 5.3 运行 `bun run build` 重建 `dist/index.js`，验证其含 Windows 分支（`cmd.exe`/`buildSpawn` 逻辑）与源码一致
- [ ] 5.4 运行时实测（Windows）：对至少一个账号完成一次性 SSO 登录后，调用 `plan_stats`，验证该行返回真实 `session/weekly/monthly` percent 而非「arkcli 不可用」
- [x] 5.5 运行 `openspec validate fix-arkcli-windows-spawn`，校验通过
