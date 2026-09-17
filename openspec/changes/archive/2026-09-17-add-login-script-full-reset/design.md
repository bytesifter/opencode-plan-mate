## Context

动机见 `proposal.md`。现状（`scripts/login-arkcli-accounts.ts`，由 `add-account-login-script` + `add-login-script-legacy-cleanup` 累积）：

- `main()`：解析 accounts → `hasNestedPollution` 配置校验（中止）→ `collectNestedLegacy`/`cleanupLegacyNested` 清理账号内嵌套分支 → dry-run / 登录
- `openURL(url)`：`spawn(plan.file, plan.args, { stdio: "ignore" })`，**不注入 env** → 继承脚本进程 `USERPROFILE`
- `loginAccount`：每账号 `rmSync(home)` + 登录 + profile 兜底 + 验证

实测发现：清理后嵌套残留会**再次出现**——`openURL` 打开的浏览器/rundll32 继承被污染的 `USERPROFILE`，把浏览器缓存写进错误路径；历史多层嵌套也无法被「只删最外层分支」清干净。用户决策：**每次启动直接全量清空 `~/.arkcli-accounts/` 再重登**。

## Goals / Non-Goals

**Goals:**

- 启动时 `rmSync("~/.arkcli-accounts", { recursive, force })` 全量清空账号根目录，一劳永逸消除历史嵌套残留
- `openURL` 打开浏览器时注入 `HOME`/`USERPROFILE` = 当前账号 HOME，阻断「继承污染 env 写入错误路径」
- 移除局部清理函数 `collectNestedLegacy`/`cleanupLegacyNested`（被全量清空取代）
- 保留 `trustedHomeDir` 污染回退与 `hasNestedPollution` 配置校验
- `--dry-run` 只报告不删除

**Non-Goals:**

- 不改 `trustedHomeDir` / `hasNestedPollution` / `buildSpawn` / `execArkcli` 现有行为
- 不做账号级增量（如只登某账号）——全量清空 + 全量重登是本脚本语义
- 不处理「未订阅账号」分类（`profile create` 报未订阅标失败，属另一独立问题，不在本 change）

## Decisions

### 决策一：全量清空账号根目录，而非逐分支清理

`main()` 在配置校验通过后、dry-run/登录前执行 `rmSync(账号根目录, { recursive: true, force: true })`。

- 账号根目录 = `dirname(accounts[0].home)`（所有账号 HOME 的公共父目录，即 `~/.arkcli-accounts`）。
- 备选（现状）：逐分支 `cleanupLegacyNested` —— 只删账号内嵌套分支，删不净历史多层残留，且无法防登录过程再次写入，弃用。
- 全量清空后，`loginAccount` 内的 `rmSync(home)` 变为幂等冗余（目录已不存在，`force` 忽略），保留以保持函数自洽。

### 决策二：`openURL` 注入隔离 env

`openURL(url)` 增加 `home` 参数 → `openURL(url, home)`；`buildOpenPlan` 不变（仍返回 `{ file, args }`），spawn 时加 `env: { ...process.env, HOME: home, USERPROFILE: home }`。

- 阻断链路：脚本进程 `USERPROFILE` 污染 → 浏览器子进程继承 → 缓存写进错误路径。注入后浏览器组件按当前账号 HOME 写入。
- 备选：不注入（现状）—— 实测已导致 `AppData\Local\Microsoft\Internet Explorer\...` 出现在嵌套链，弃用。

### 决策三：dry-run 语义

dry-run 不实际删除：打印「将清空 `~/.arkcli-accounts/` + 逐账号登录清单」后返回，与「预览全部动作」一致。

### 决策四：删除局部清理函数

`collectNestedLegacy` / `cleanupLegacyNested` / `CleanupResult` 及其 import（`readdirSync`/`statSync`）一并移除，同步删除对应单测，避免死代码。

## Risks / Trade-offs

- [全量清空副作用] 每次运行删掉所有账号 HOME（含已登录成功账号）→ 正是「全量重登」语义，用户已明确要求；文档明示
- [`rmSync` 失败] Windows 句柄占用致 EPERM → 启动清空失败应中止并提示（登录前环境必须干净），与 `loginAccount` 内失败隔离不同
- [浏览器注入 env] 极端情况下浏览器可能对隔离 HOME 的 `AppData` 路径敏感 → 实测方向正确（阻断缓存写污染路径），跨平台行为一致
- [归档顺序] 本 change 是 `account-login-script` 的第三次修改，须在 `add-login-script-legacy-cleanup` 归档（主 spec 含其 MODIFIED）之后归档
