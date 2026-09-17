## Context

动机见 `proposal.md`。现状：`add-account-login-script` 已实现 `trustedHomeDir()`（污染回退）与 `hasNestedPollution()`（配置路径嵌套中止），但磁盘上账号 HOME 内残留的嵌套 `.arkcli-accounts` 分支只能手动清。本 change 让脚本默认执行时自动清理磁盘垃圾，与现有「配置污染中止」互补。

相关现有实现（`scripts/login-arkcli-accounts.ts`）：
- `POLLUTION_MARKER = ".arkcli-accounts"`：脚本自管目录标记
- `hasNestedPollution(home)`：按路径片段计数判断配置污染（>1 次即嵌套）
- `main()` 启动后先做配置污染校验，再 dry-run / 登录

## Goals / Non-Goals

**Goals:**

- 脚本默认执行即扫描并自动删除账号 HOME 内的嵌套 `.arkcli-accounts` 分支
- 清理只删嵌套分支，保留账号 HOME 顶层
- `--dry-run` 只报告不删除
- 配置写死嵌套路径仍中止（与现有行为一致，不混淆两类问题）
- 纯函数拆分，跨平台可单测

**Non-Goals:**

- 不清理账号 HOME 顶层本身（那是登录流程 `rmSync(home)` 的职责，重登时删）
- 不校验嵌套分支内是否有「有效」登录态——嵌套分支本身即为垃圾，无条件删
- 不改 `trustedHomeDir` / `hasNestedPollution` 现有行为

## Decisions

### 决策一：清理触发点放在主流程启动后、配置校验之后

顺序：解析 accounts → 配置污染校验（中止）→ **磁盘嵌套垃圾清理** → dry-run / 登录。

- 理由：先保证配置合法，再清磁盘。配置污染中止在前，磁盘清理在后，避免「配置错了还去扫盘」。
- dry-run 在清理之后：dry-run 仍应报告将清理的分支（因为 dry-run 语义是「预览将执行的全部动作」），但不实际删。

### 决策二：两个纯函数分离扫描与删除

```
collectNestedLegacy(homeRoot: string): string[]
  → 列出 homeRoot 下所有账号目录内部含 .arkcli-accounts 的嵌套分支路径
cleanupLegacyNested(homeRoot: string): { removed: string[]; failed: string[] }
  → 逐个 rmSync 删除 collectNestedLegacy 的产物,失败隔离收集
```

- 扫描规则：遍历 `homeRoot/<acct>/` 每个账号目录，递归查找其中名为 `.arkcli-accounts` 的子目录；找到即为嵌套分支（账号顶层自身不算）。
- dry-run 只调 `collectNestedLegacy` 打印，不调 `cleanupLegacyNested`。
- 纯函数注入 `homeRoot`（而非硬编码），便于单测用临时目录构造嵌套结构。
- 备选：一个函数内做扫描+删除 —— 无法单独测扫描、无法支持 dry-run，不选。

### 决策三：删除失败隔离不阻断登录

`cleanupLegacyNested` 删除单个分支失败（如 Windows 句柄占用）时收集到 `failed`，打印警告，继续尝试其余分支，SHALL NOT 中断整个登录流程。账号自身的 `rmSync(home)` 失败（如 EPERM）仍按现有逻辑标该账号失败。

## Risks / Trade-offs

- [误删风险] 清理规则把「账号目录内任何名为 `.arkcli-accounts` 的子目录」当垃圾 → 该目录名是脚本自管标记，账号顶层之下出现它只可能是污染残留，风险低；测试用临时目录构造验证
- [删除失败] Windows 句柄占用导致 rmSync EPERM → 收集 failed 警告，不阻断，可下次重跑
- [dry-run 语义] dry-run 报告将清理但不删 → 与「dry-run 不产生副作用」一致
- [与配置校验重叠] 配置污染（路径含嵌套）与磁盘垃圾（目录存在嵌套）是两类 → 处理分离：前者中止、后者清理，spec 已区分
