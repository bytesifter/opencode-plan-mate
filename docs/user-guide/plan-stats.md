# 套餐配额统计（plan_stats）

## 能力说明

`plan_stats` 工具返回各账号 Coding Plan 的**官方配额**快照（已用百分比 + 重置时间），按账号分行。数据来自 ARK 控制面（官方 quota），与插件自记录的请求/token（`plan_mate_stats`）是两回事：

| | `plan_mate_stats` | `plan_stats` |
|---|---|---|
| 数据 | 本机实际请求/token | 官方套餐配额 percent |
| 配置 | 零（复用 providers） | `planStats.accounts` 映射 |
| 依赖 | 无 | arkcli + 每账号独立 HOME SSO 登录 |
| 用途 | 看消耗 | 看额度还剩多少 |

## 前置依赖

- 本机安装 [arkcli](https://www.npmjs.com/package/@volcengine/ark-cli)
- 每个参与统计的火山账号，在**独立 HOME 目录**下完成一次性 SSO 登录（见下方 setup）

为什么需要 arkcli + 每账号独立 HOME：

- 官方配额（`usage plan`）是 ARK **控制面**数据，仅接受该账号的 SSO 登录态；Coding Plan API key（数据面凭证）直连控制面会被拒
- arkcli 是**单身份模型**：一个配置（`$HOME/.arkcli`）同时只能登录一个火山账号。因此**每个火山账号必须用一套独立 HOME**，插件按账号以对应 HOME 运行 `arkcli usage plan`
- arkcli 在不同平台读取不同的 home 环境变量：POSIX 认 `HOME`，Windows 认 `USERPROFILE`。插件已按平台同时注入两者，故 `planStats.accounts` 的路径在两个平台都生效

## 配置

在插件 options 中声明账号映射（显示名 → 独立 arkcli HOME 目录）：

```jsonc
"plugins": [
  {
    "package": "file:///path/to/opencode-plan-mate",
    "options": {
      "providers": ["account-a", "account-b"],
      "planStats": {
        "accounts": {
          "account-a": "~/.arkcli-accounts/account-a",
          "account-b": "~/.arkcli-accounts/account-b"
        }
      }
    }
  }
]
```

行名 = 显示名（key）；HOME 目录决定用哪个账号的登录态。支持 `~` 展开。

## 每账号一次性 SSO 登录

每个参与统计的账号都必须在独立 HOME 下完成一次 SSO 登录。**推荐用仓库自带脚本一键全量登录**，也可手工逐个登录（兜底）。

### 方式一：登录脚本（推荐）

`scripts/login-arkcli-accounts.ts` 读取 `opencode.jsonc` 的 `planStats.accounts`，**每次执行先清空所有账号的 HOME 目录**，再逐个走 `--no-browser` 跨设备流登录并验证。需要 [bun](https://bun.sh) 与 `bun install`（含 `jsonc-parser`）。

POSIX（Linux / macOS）：

```bash
cd opencode-plan-mate
bun scripts/login-arkcli-accounts.ts                  # 默认读 ./opencode.jsonc
bun scripts/login-arkcli-accounts.ts --config ~/.config/opencode/opencode.jsonc
bun scripts/login-arkcli-accounts.ts --dry-run        # 只打印将登录的账号与 HOME,不实际登录
```

Windows（PowerShell）——脚本不展开 `--config` 路径的 `~`，PowerShell 也会把 `~` 原样传给子进程，需用 `$env:USERPROFILE` 显式展开：

```powershell
cd opencode-plan-mate
bun scripts/login-arkcli-accounts.ts                        # 默认读 ./opencode.jsonc
bun scripts/login-arkcli-accounts.ts --config "$env:USERPROFILE\.config\opencode\opencode.jsonc"
bun scripts/login-arkcli-accounts.ts --dry-run              # 只打印将登录的账号与 HOME,不实际登录
```

交互流程（每账号）：脚本打开浏览器 → 你在浏览器完成火山 SSO 授权 → 页面显示 base64 授权码 → 复制回终端粘贴 → 脚本完成登录、profile 兜底与 `usage plan` 验证。单账号失败会标注原因并继续下一个，全部结束汇总成功/失败清单（有失败则非零退出）。

> 注意：脚本每次**全量清空重登**，不会保留已有登录态。想临时只登部分账号，用 `--dry-run` 确认清单后再手工执行对应账号。

**自动清理**：脚本每次启动会**全量清空账号根目录**（`~/.arkcli-accounts/`，含所有账号登录态与历史嵌套残留），再逐账号重新登录，确保环境干净。`--dry-run` 会预览将清空的目录与登录清单但不会实际删除。若 `opencode.jsonc` 里账号路径本身写成了嵌套路径（配置错误），脚本会中止并提示，需修正配置而非依赖清理。浏览器授权子进程注入的是**可信真实用户 home**（污染回退后），浏览器/WinINet 缓存（如 `Content.IE5`）写入真实 profile，**不写入账号 HOME**——账号 HOME 只保留 arkcli 登录态，保证下次清空可正常删除。

### 方式二：手工逐个登录（兜底）

用 `--no-browser` 跨设备流（redirect_uri 为 signin URL，无本地端口回调，可避开浏览器回调的 `redirect_uri` 报错）。

POSIX（Linux / macOS）：

```bash
# 首次运行 arkcli 会自动创建 $HOME/.arkcli（含父目录），无需预建目录
HOME=~/.arkcli-accounts/account-a arkcli profile create --name default --region cn-beijing --set-default
HOME=~/.arkcli-accounts/account-a arkcli auth login --no-browser                 # Phase 1：打开 URL 浏览器授权
HOME=~/.arkcli-accounts/account-a arkcli auth login --no-browser --code <授权码>  # Phase 2：粘贴 base64 授权码
# 验证
HOME=~/.arkcli-accounts/account-a arkcli usage plan --product coding-plan --format json
```

Windows（PowerShell）—— arkcli 读取 `USERPROFILE`（忽略 `HOME`）：

```powershell
$base = "$env:USERPROFILE\.arkcli-accounts"   # 基准单独存,不要改写后再拿它拼下一个账号
$env:USERPROFILE = "$base\account-a"           # arkcli 目录自建,无需 mkdir
$env:HOME        = "$base\account-a"           # 同时设置,兼容按 HOME 解析的场景
arkcli profile create --name default --region cn-beijing --set-default
arkcli auth login --no-browser                 # Phase 1：打开 URL 浏览器授权
arkcli auth login --no-browser --code <授权码>  # Phase 2：粘贴 base64 授权码
# 验证
arkcli usage plan --product coding-plan --format json
```

对每个账号重复以上步骤（每个账号一个独立目录）。两段式 Phase 1 / Phase 2 必须在同一环境执行。

> Windows 注意：不要写成 `$env:USERPROFILE = "$env:USERPROFILE\.arkcli-accounts\account-a"` 后在下一个账号里继续用 `$env:USERPROFILE` 拼路径——`USERPROFILE` 已被覆盖，会拼出 `...\account-a\.arkcli-accounts\account-b\...` 的嵌套目录。始终用上面的 `$base` 基准变量。

## 用法

对 LLM 说「看套餐配额」，LLM 会调用 `plan_stats` 工具，返回类似：

```
coding-plan 官方配额 (plan_stats)
profile           session           weekly            monthly
account-a         ███·····  40%     ████····  55%     ██······  30%
                  重置 09-05 12:00
account-b         —                 —                 —
                  (未订阅/无套餐)
```

说明：

- CodingPlan 后端只返回 percent（无绝对 used/total），因此只展示百分比柱与重置时间
- 单个账号未登录/未订阅/失败会在对应行标注，不影响其他账号
- 未配置 `planStats` 时工具返回配置提示

## FAQ 与排障

| 现象 | 原因 | 处理 |
|------|------|------|
| 行显示「未登录（需 arkcli auth login volc-sso）」 | 该账号在对应 HOME 未完成 SSO 登录 | 在该 HOME 执行 `--no-browser` 两段式登录 |
| 行显示「arkcli 不可用」 | 本机未安装 arkcli 或命令不可执行 | 安装 arkcli |
| 行显示「未订阅/无套餐」 | 该账号未持有 Coding Plan | 确认账号是否订阅 |
| 行显示「usage plan 未返回 coding-plan 桶」 | arkcli 输出与预期结构不符 | 人工核对：POSIX 用 `HOME=<该账号> arkcli usage plan --product coding-plan --format json`；Windows 用 `$env:USERPROFILE="<该账号>"; arkcli usage plan --product coding-plan --format json` |
| 所有行都一样 | 多个账号配到了同一个 HOME / 未用独立 HOME | 检查 `planStats.accounts` 每个账号指向独立目录 |
| 浏览器 SSO 报 `redirect_uri` 错误 | `volc-sso` 浏览器流本地端口回调偶发失败 | 改用 `--no-browser` 跨设备流登录 |
| 某账号百分比 100% | 该账号月度/周度配额已用完 | 换账号或等重置（重置时间见对应行） |
