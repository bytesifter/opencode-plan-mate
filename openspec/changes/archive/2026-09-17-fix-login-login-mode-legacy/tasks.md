# fix-login-login-mode-legacy Tasks

## 1. 登录链路锁定 legacy

- [x] 1.1 `loginAccount` phase1 改为 `execArkcli(["auth", "login", "--no-browser", "--login-mode", "legacy"], home)`；验证 `bunx tsc --noEmit` 干净
- [x] 1.2 `loginAccount` phase2 改为 `execArkcli(["auth", "login", "--no-browser", "--login-mode", "legacy", "--code", code], home)`；验证 `bunx tsc --noEmit` 干净

## 2. 测试

- [x] 2.1 在 `tests/login-script.test.ts` 增加/调整用例：断言 `loginAccount` 的 phase1 与 phase2 调用均携带 `--login-mode legacy`（如抽取调用参数辅助函数或重构为可注入 args 的纯函数后断言）；验证 `bun test tests/login-script.test.ts` 全绿

## 3. 验证

- [x] 3.1 运行 `bun test`、`bunx tsc --noEmit`、`openspec validate fix-login-login-mode-legacy` 全绿
- [x] 3.2 运行时实测：直跑 arkcli `auth login --no-browser --login-mode legacy` 确认 stdout 返回含 `authorize_url` 的 JSON 且立即退出（非阻塞）；`--dry-run` 确认脚本清单正常
