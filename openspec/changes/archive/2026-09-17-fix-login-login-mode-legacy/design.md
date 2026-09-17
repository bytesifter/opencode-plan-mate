# fix-login-login-mode-legacy Design

## Context

见 proposal.md —— Why 已说明。当前 `loginAccount`(scripts/login-arkcli-accounts.ts:355)执行:

- phase1:`execArkcli(["auth", "login", "--no-browser"], home)` → `parseAuthorizeUrl(phase1.stdout)`
- phase2:`execArkcli(["auth", "login", "--no-browser", "--code", code], home)`

`execArkcli` → `exec` → win32 上 `spawn("cmd.exe", ["/c", "arkcli", ...])`,stdio `["ignore","pipe","pipe"]`,60s 超时 `child.kill()`。

实测(arkcli v1.0.30):
- 默认 `--login-mode auto`:broker 链路,stdout 纯文本「请手动访问: <url?callbackPort=...>」+「等待浏览器认证完成...」,启动本地回调服务器后**阻塞**,不退出。
- `--login-mode legacy`:stdout 干净 JSON(`authorize_url`/`stage`/`next_command`/`method:"sso_no_browser"`),exit 0;人类提示走 stderr。

## Goals / Non-Goals

**Goals:**
- `auth login` 恢复脚本设计时验证的 legacy 跨设备链路(JSON + 立即退出),解除死锁。
- 保留跨设备贴码交互模型(任意设备浏览器均可完成授权)。

**Non-Goals:**
- 不改造 broker 链路(流式读 URL + 等本地回调)——设计曾明确拒绝本地回调,且要求浏览器与本机回调端口可达。
- 不修 `exec` 的「孙进程握管道致 `close` 不触发」健壮性缺陷(超出本 change 范围,留作后续)。

## Decisions

### 决策一:phase1/phase2 均追加 `--login-mode legacy`

```ts
const phase1 = await execArkcli(["auth", "login", "--no-browser", "--login-mode", "legacy"], home)
...
const phase2 = await execArkcli(["auth", "login", "--no-browser", "--login-mode", "legacy", "--code", code], home)
```

- **为什么**:legacy 是脚本既有解析逻辑(`parseAuthorizeUrl`)与归档 design「已验证 stdout 是干净 JSON」所对应的链路;一个 flag 恢复契约,交互模型零改动。
- **备选被否**:适配 broker(auto)需把 `exec` 改为流式、抓纯文本 URL、等回调、去掉贴码——改动大、绑定同机浏览器、违反原设计 Non-Goal。
- **风险缓解**:若未来 arkcli 移除 legacy 链,`auth login` 会报未知/不可用错误(非挂死),届时再评估 broker 适配;本 change 不掩盖该信号。

### 决策二:在 `exec` 层对 broker 阻塞的兜底(不引入)

不额外改动 `exec`:legacy 下 phase1 立即返回,不再触发 cmd-孙进程管道挂起路径;把该健壮性缺陷单列为后续议题,避免本 change 混入两个修复面。

## Risks / Trade-offs

- [arkcli 未来移除 legacy 链] → `auth login` 报错(非挂死),脚本标注账号失败并继续;后续再适配 broker。当前 v1.0.30 legacy 可用且是 `--code` 的官方语义(help:「无浏览器 Phase 2」)。
- [归档顺序] → 本 change 与 `fix-login-openurl-trusted-home`、未归档 `add-login-script-full-reset` 均改同一 requirement;各 delta 均携带完整终态文本,归档顺序不互相覆盖丢失。
- [`--login-mode legacy` 与 `--code` 组合] → 实测 phase1 legacy 的 `next_command` 即 `arkcli auth login --no-browser --code <code>`,与脚本 phase2 完全一致;组合有效。

## Migration Plan

- 无部署步骤;改后重跑 `bun scripts/login-arkcli-accounts.ts ...` 即可。
- 回滚:revert 本 change。

## Open Questions

无。
