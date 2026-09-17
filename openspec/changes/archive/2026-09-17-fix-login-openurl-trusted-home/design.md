# fix-login-openurl-trusted-home Design

## Context

见 proposal.md —— Why 已说明根因。当前实现:

- `buildOpenPlanEnv(platform, url, home, env)`(login-arkcli-accounts.ts:266)返回 `{ ...env, HOME: home, USERPROFILE: home }`,`home` 即账号独立 HOME。
- `openURL(url, home)`(:251)以该 env spawn `rundll32 url.dll,FileProtocolHandler`(Win32)/`open`/`xdg-open`。
- `loginAccount`(:367)调用 `openURL(url, home)`。
- 已有 `trustedHomeDir(env)`(:67):当 `USERPROFILE` 含 `.arkcli-accounts` 污染片段时回退到 `HOMEDRIVE+HOMEPATH`(兜底 `C:\Users\<USERNAME>`),否则原样返回;已用于 `~` 展开与单测覆盖。

## Goals / Non-Goals

**Goals:**
- 浏览器子进程的 `HOME`/`USERPROFILE` 指向可信真实 home,使 WinINet 缓存(含受保护 ACL 的 `Content.IE5`)不再进入账号 HOME,全量清空永不撞 `Deny ReadData` EPERM。
- 保留原「阻断继承污染 env」意图(`trustedHomeDir` 回退仍生效)。
- 修正误导性失败提示。

**Non-Goals:**
- 不处理存量已污染目录(用户已手动 `icacls` 解堵;文档记一次性命令即可)。
- 不做 `rmSync` 的 ACL 自愈/重试——防再犯靠注入修正而非删除加固。
- 不改插件的 arkcli 调用:`HOME=账号 home` 对 arkcli 是正确隔离,不受影响。

## Decisions

### 决策一:注入源从账号 HOME 改为 `trustedHomeDir(env)`

`buildOpenPlanEnv` 注入改为 `{ HOME: trustedHomeDir(env), USERPROFILE: trustedHomeDir(env) }`。

- **为什么**:rundll32 的 WinINet 会把 IE 缓存(含 `Content.IE5` 及其 `Deny Everyone ReadData` ACL)写进注入的 `USERPROFILE`。注入账号 HOME → 账号 HOME 被污染且下次全量清空必 EPERM;注入可信真实 home → 缓存写真实 profile(Windows 每次用 WinINet 的标准行为,无害,且真实 `INetCache` 已被系统排除索引),账号 HOME 只留 `.arkcli`。
- **用 `env` 而非全局 `process.env`**:`trustedHomeDir` 本就接受 env 参数,保持纯函数可测性(测试注入污染 env 断言回退)。
- **备选被否**:① 保持注入账号 home + 删除前用 `icacls /remove:d Everyone /T` 剥 ACL —— 治标,垃圾仍每次堆积,且引入外部命令依赖;② 干净时不注入 —— 与「始终注入 trustedHomeDir」等价(干净时二者相同),多一条分支无收益。

### 决策二:删除 `home` 参数

`buildOpenPlanEnv` / `openURL` 的 `home` 参数仅用于 env 注入,改源后成为死参数,删除;`loginAccount` 改调 `openURL(url)`。签名变化同步更新测试。

### 决策三:失败提示改为客观表述

`main()` 全量清空失败提示从「请关闭占用后重试」改为不预判原因(如「清空账号根目录失败」+ 原始 `err`)。用户无需被误导去「关闭进程」;真实 ACL/占用信息由 `err.message` 呈现。

## Risks / Trade-offs

- [浏览器缓存写入真实用户 profile] → Windows 标准行为,真实 `INetCache` 系统已排除索引;浏览器(Chrome)profile 走真实 `LOCALAPPDATA`,不受影响。低风险。
- [POSIX 行为变化] → `open`/`xdg-open` 子进程 `HOME` 从账号 home 变真实 home;浏览器缓存写真实 home 属正常,SSO 登录不依赖子进程 HOME。无功能影响。
- [归档顺序] → 本 change 修正未归档 `add-login-script-full-reset` 的同一 requirement(其语义为「注入账号 HOME」)。本 change 的 MODIFIED 必须覆盖旧语义;归档时应确保本 change 在 full-reset 之后(或一并归档),否则主 spec 会残留旧约束。
- [真实 USERPROFILE 被污染回退缺失] → `trustedHomeDir` 已有完整回退链(HOMEDRIVE+HOMEPATH → USERNAME),已单测覆盖。

## Migration Plan

- 无部署步骤(本地脚本)。
- 存量解堵(一次性):`icacls "<~/.arkcli-accounts>" /remove:d Everyone /T /C`,再跑脚本全量重登。
- 回滚:revert 本 change 即可;注入恢复账号 home 后旧 EPERM 场景复现,属预期。

## Open Questions

无。
