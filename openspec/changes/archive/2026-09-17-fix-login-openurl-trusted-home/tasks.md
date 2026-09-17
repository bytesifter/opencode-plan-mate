# fix-login-openurl-trusted-home Tasks

## 1. 注入源修正(login-arkcli-accounts.ts)

- [x] 1.1 `buildOpenPlanEnv` 的 env 注入从 `{ HOME: home, USERPROFILE: home }` 改为 `{ HOME: trustedHomeDir(env), USERPROFILE: trustedHomeDir(env) }`，并删除 `home` 参数；验证 `bunx tsc --noEmit` 干净
- [x] 1.2 `openURL` 删除 `home` 参数，内部调用 `buildOpenPlanEnv(platform, url, process.env)`（不再传账号 home）；`loginAccount` 改调 `openURL(url)`；验证 `bunx tsc --noEmit` 干净

## 2. 报错文案

- [x] 2.1 `main()` 全量清空失败提示去掉「请关闭占用后重试」的预判表述，改为客观文案（如「清空账号根目录失败」+ 原始 `err`）；验证输出不再误导用户去「关闭进程」

## 3. 测试更新

- [x] 3.1 更新 `tests/login-script.test.ts` 的 `buildOpenPlanEnv` 用例：干净 env → 注入 `HOME`/`USERPROFILE` = 该干净 home；污染 env（含 `HOMEDRIVE`/`HOMEPATH`）→ 注入回退后的真实 home（SHALL NOT 是账号 home、SHALL NOT 是污染路径）；其它 env 保留；删除对 `home` 参数的引用；验证 `bun test tests/login-script.test.ts` 全绿

## 4. 文档

- [x] 4.1 更新 `docs/user-guide/plan-stats.md` 自动清理段：补充「浏览器子进程注入可信真实 home，浏览器缓存不写入账号 HOME」说明；验证段落含该说明

## 5. 验证

- [x] 5.1 运行 `bun test`、`bunx tsc --noEmit`、`openspec validate fix-login-openurl-trusted-home` 全绿
- [x] 5.2 运行时实测（可选）：`--dry-run` 确认清单正常；完整跑一次确认全量清空与登录不再撞 EPERM
