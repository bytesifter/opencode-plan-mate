## 1. 全量清空

- [x] 1.1 `main()`：配置校验通过后、dry-run/登录前，改为 `rmSync(账号根目录, { recursive, force })` 全量清空 `~/.arkcli-accounts/`；验证用临时目录构造多账号 + 嵌套残留，断言清空后根目录不存在
- [x] 1.2 启动清空失败（EPERM）时打印错误并返回非零退出；验证模拟占用场景中止

## 2. openURL 隔离 env

- [x] 2.1 `openURL(url, home)` 增加 home 参数，spawn 时注入 `env: { HOME: home, USERPROFILE: home }`；`buildOpenPlan` 不变；验证三平台 spawn 计划含注入 env（注入后断言子进程 env 的 USERPROFILE=home）
- [x] 2.2 `loginAccount` 调用 `openURL(url, home)` 传入当前账号 home；验证编译通过、既有调用点更新

## 3. 清理死代码与测试

- [x] 3.1 移除 `collectNestedLegacy` / `cleanupLegacyNested` / `CleanupResult` 及 `readdirSync`/`statSync` import；`loginAccount` 保留每账号 `rmSync(home)`（幂等冗余）；验证 `tsc --noEmit` 干净
- [x] 3.2 删除 tests 中嵌套清理用例，新增：全量清空（多账号+嵌套→根目录消失）、openURL env 注入（三平台 USERPROFILE=home）；运行 `bun test` 全绿
- [x] 3.3 更新 `docs/user-guide/plan-stats.md`：清理说明改为「每次启动全量清空账号根目录重登」，dry-run 预览不变

## 4. 验证

- [x] 4.1 运行 `bun test`、`bunx tsc --noEmit`、`openspec validate add-login-script-full-reset` 全绿
- [x] 4.2 运行时实测（可选）：构造临时嵌套目录后 `--dry-run` 确认报告不删；默认跑确认根目录被清空且登录继续
