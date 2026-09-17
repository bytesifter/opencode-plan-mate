# fix-login-openurl-trusted-home

## Why

登录脚本每次启动全量清空账号根目录时偶发 `EPERM` 失败。根因:`openURL` 把浏览器子进程的 `USERPROFILE` 注入为**账号独立 HOME**,而 Windows 上用 `rundll32 url.dll,FileProtocolHandler` 打开授权 URL 会走 WinINet 栈,在注入的 `USERPROFILE` 下创建 IE 缓存目录(`INetCache\Content.IE5` 等),且 Windows 给 `Content.IE5` 打上受保护的 `Deny Everyone ReadData` ACL。下次 `resetAccountRoot` 递归删除时无法枚举该目录 → `EPERM`,脚本却提示「请关闭占用后重试」,误导用户(实际无任何进程占用)。

## What Changes

- `buildOpenPlanEnv` / `openURL`:浏览器子进程注入的 `HOME`/`USERPROFILE` 从「账号独立 HOME」改为「可信真实用户 home(`trustedHomeDir` 结果)」,不再把浏览器/WinINet 缓存写进账号 HOME;`home` 参数删除。
- `loginAccount`:`openURL(url, home)` 改为 `openURL(url)`。
- `main()` 全量清空失败提示:去掉「请关闭占用后重试」的误导性推断,改为客观表述(可能被进程占用或含受保护 ACL 子目录)。
- 测试:`buildOpenPlanEnv` 用例改为断言注入可信 home(含「污染 env 回退」用例)。
- 文档:`docs/user-guide/plan-stats.md` 自动清理段补充说明浏览器缓存不写入账号 HOME。
- 规格:`account-login-script` 的「浏览器 + 贴码交互登录」requirement 修改(见 Capabilities)。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `account-login-script`:修改「浏览器 + 贴码交互登录」requirement——打开浏览器的子进程 SHALL 注入 `HOME`/`USERPROFILE` 为**可信真实用户 home**(污染回退后),SHALL NOT 注入账号独立 HOME,SHALL NOT 把浏览器/WinINet 缓存(含受保护 ACL 的 `Content.IE5`)写入账号 HOME。该约束修正上游 `add-login-script-full-reset` 中「注入账号 HOME」的语义。

## Impact

- `scripts/login-arkcli-accounts.ts`:`buildOpenPlanEnv`(env 注入源 + 删 `home` 参数)、`openURL`、`loginAccount` 调用点、`main()` 报错文案。
- `tests/login-script.test.ts`:`buildOpenPlanEnv` 用例改断言。
- `docs/user-guide/plan-stats.md`:自动清理段落补充说明。
- `openspec/specs/account-login-script/spec.md`:delta 修改。
- 上游关联:未归档的 `add-login-script-full-reset` change 的「浏览器子进程注入隔离 HOME」场景语义被本 change 修正,归档顺序需在本 change 之后或一并处理。
- 无新依赖;不改动插件运行逻辑(仅登录脚本与文档)。
