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

> **新增账号**：给 `planStats.accounts` 加一行（显示名 + 独立 HOME 目录），然后对该账号跑一次登录脚本即可（如 `bun scripts/login-arkcli-accounts.ts --only <新账号名>`，脚本会自动创建 HOME 并完成 SSO 登录）。显示名建议与账号真实身份一致，避免标签错位（如历史遗留 `volxc5426` 实际身份是 `vollqh5426`，两者指向同一账号）。

## 每账号一次性 SSO 登录

每个参与统计的账号都必须在独立 HOME 下完成一次 SSO 登录。**推荐用仓库自带脚本一键增量补登**，也可手工逐个登录（兜底）。

### 方式一：登录脚本（推荐）

`scripts/login-arkcli-accounts.ts` 读取 `opencode.jsonc` 的 `planStats.accounts`，**默认增量**：先逐账号 `auth status` 探测登录态，仅对过期/未登录/缺失的账号清空其 HOME 并重登（`--no-browser` 跨设备流），有效账号跳过；`--force` 可恢复旧全量清空重登。需要 [bun](https://bun.sh) 与 `bun install`（含 `jsonc-parser`）。

POSIX（Linux / macOS）：

```bash
cd opencode-plan-mate
bun scripts/login-arkcli-accounts.ts                        # 默认增量,读 ./opencode.jsonc
bun scripts/login-arkcli-accounts.ts --config ~/.config/opencode/opencode.jsonc
bun scripts/login-arkcli-accounts.ts --dry-run              # 只打印每账号「跳过/重登」分类,不登录
bun scripts/login-arkcli-accounts.ts --force                # 全量清空后重登全部账号
bun scripts/login-arkcli-accounts.ts --only <name>          # 只处理指定账号
bun scripts/login-arkcli-accounts.ts --browser normal       # 普通模式打开(默认隐身)
bun scripts/login-arkcli-accounts.ts --code-input manual    # 强制手工粘贴(默认剪贴板捕获)
```

Windows（PowerShell）——脚本不展开 `--config` 路径的 `~`，PowerShell 也会把 `~` 原样传给子进程，需用 `$env:USERPROFILE` 显式展开：

```powershell
cd opencode-plan-mate
bun scripts/login-arkcli-accounts.ts                        # 默认增量,读 ./opencode.jsonc
bun scripts/login-arkcli-accounts.ts --config "$env:USERPROFILE\.config\opencode\opencode.jsonc"
bun scripts/login-arkcli-accounts.ts --dry-run              # 只打印每账号「跳过/重登」分类,不登录
```

交互流程（每账号，cross-device 默认）：脚本**以隐身窗口自动打开浏览器**（`--browser normal` 可切普通模式）→ 你在浏览器完成火山 SSO 授权 → 页面显示 base64 授权码 → **复制即可**（脚本自动从剪贴板捕获，按 Phase 1 的 `state` 校验防误捕）→ 脚本完成登录、profile 兜底与 `usage plan` 验证。剪贴板不可用/校验不中/超时回退手工粘贴；`--code-input manual` 强制手工。单账号失败会标注原因并继续下一个，全部结束汇总成功/失败清单（有失败则非零退出）。

> 注意：默认**增量只补过期**，有效账号保留登录态跳过。想全量重登用 `--force`；只登某个账号用 `--only <name>`。`--flow local-callback` 可选本地回调流（arkcli 自开普通模式浏览器、授权后自动回调完成免复制），失败自动回退跨设备流。

**自动清理**：增量模式仅清空判定为需重登的账号 HOME（含其内嵌套残留）；`--force` 才清空整个账号根目录（`~/.arkcli-accounts/`）。若 `opencode.jsonc` 里账号路径本身写成了嵌套路径（配置错误），脚本会中止并提示，需修正配置而非依赖清理。浏览器授权子进程注入的是**可信真实用户 home**（污染回退后），浏览器/WinINet 缓存（如 `Content.IE5`）写入真实 profile，**不写入账号 HOME**——账号 HOME 只保留 arkcli 登录态，保证下次清空可正常删除。

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

> **为什么没有 SSO 保活？** 火山 SSO 的 refresh_token 是**服务端绝对有效期**（约 48 小时，实测约 46 小时即失效），刷新不轮换、不续期（sliding 不成立），因此任何后台定期执行 `arkcli auth status` 的"保活"都无法延长登录态——**此方案已实测失败并永久移除**。且 CodingPlan 配额接口仅接受 SSO STS（apikey 与长效 AK/SK 实测均不可行，AK/SK 登录通道已关），不存在绕开 SSO 的替代凭证。`plan_stats` 采用按需查询：SSO 过期时由配额查询失败标注过期错误（如「SSO 已过期，需重登」）。请勿重新尝试保活或 AK/SK 方案。

| 现象 | 原因 | 处理 |
|------|------|------|
| 行显示「SSO 已过期 / 未登录」 | 该账号在对应 HOME 的 SSO 登录态已过期（refresh_token 约 48h 绝对有效期）或未登录 | 运行 `bun scripts/login-arkcli-accounts.ts`（默认增量，只补过期账号；`--only <name>` 定向补单个） |
| 行显示「arkcli 不可用」 | 本机未安装 arkcli 或命令不可执行 | 安装 arkcli |
| 行显示「未订阅/无套餐」 | 该账号未持有 Coding Plan | 确认账号是否订阅 |
| 行显示「usage plan 未返回 coding-plan 桶」 | arkcli 输出与预期结构不符 | 人工核对：POSIX 用 `HOME=<该账号> arkcli usage plan --product coding-plan --format json`；Windows 用 `$env:USERPROFILE="<该账号>"; arkcli usage plan --product coding-plan --format json` |
| 所有行都一样 | 多个账号配到了同一个 HOME / 未用独立 HOME | 检查 `planStats.accounts` 每个账号指向独立目录 |
| 浏览器 SSO 报 `redirect_uri` 错误 | `volc-sso` 浏览器流本地端口回调偶发失败 | 改用默认跨设备流（脚本默认即跨设备；`--flow local-callback` 失败会自动回退） |
| 某账号百分比 100% | 该账号月度/周度配额已用完 | 换账号或等重置（重置时间见对应行） |

> **为什么默认增量而不是全量重登？** SSO 约 48h 过期，全量重登意味着每 2 天把全部账号（即使还有效的）重登一遍。脚本默认先 `auth status` 探测，只补过期的，有效账号跳过。探测不可解析时按「需重登」处理（fail-safe：宁可多登一次，不跳过陈旧会话）。

> **剪贴板自动捕获是怎么工作的？** 授权码是 `base64("code=..&state=<Phase1 state>")`。脚本轮询剪贴板，仅当解码后含当前 Phase 1 的 `state` 与 `code=` 才接受并自动完成登录，避免误捕复制到剪贴板的其它内容；捕获不到时回退手工粘贴。
