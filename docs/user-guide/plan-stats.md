# 套餐配额统计（plan_stats）

## 能力说明

`plan_stats` 工具返回各账号 Coding Plan 的**官方配额**快照（已用百分比 + 重置时间），按账号分行。数据来自 ARK 控制面（官方 quota），与插件自记录的请求/token（`roundrobin_stats`）是两回事：

| | `roundrobin_stats` | `plan_stats` |
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

## 配置

在插件 options 中声明账号映射（显示名 → 独立 arkcli HOME 目录）：

```jsonc
"plugin": [
  ["file:///path/to/opencode-round-robin", {
    "providers": ["account-a", "account-b"],
    "planStats": {
      "accounts": {
        "account-a": "~/.arkcli-accounts/account-a",
        "account-b": "~/.arkcli-accounts/account-b"
      }
    }
  }]
]
```

行名 = 显示名（key）；HOME 目录决定用哪个账号的登录态。支持 `~` 展开。

## 每账号一次性 SSO 登录

用 `--no-browser` 跨设备流（redirect_uri 为 signin URL，无本地端口回调，可避开浏览器回调的 `redirect_uri` 报错）：

```bash
mkdir -p ~/.arkcli-accounts/account-a
HOME=~/.arkcli-accounts/account-a arkcli config init --profile default --region cn-beijing --set-default
HOME=~/.arkcli-accounts/account-a arkcli auth login --no-browser                 # Phase 1：打开 URL 浏览器授权
HOME=~/.arkcli-accounts/account-a arkcli auth login --no-browser --code <授权码>  # Phase 2：粘贴 base64 授权码
# 验证
HOME=~/.arkcli-accounts/account-a arkcli usage plan --product coding-plan --format json
```

对每个账号重复以上步骤（每个账号一个独立目录）。两段式 Phase 1/Phase 2 必须在同一环境执行。

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
| 行显示「usage plan 未返回 coding-plan 桶」 | arkcli 输出与预期结构不符 | 用 `HOME=<该账号> arkcli usage plan --product coding-plan --format json` 人工核对 |
| 所有行都一样 | 多个账号配到了同一个 HOME / 未用独立 HOME | 检查 `planStats.accounts` 每个账号指向独立目录 |
| 浏览器 SSO 报 `redirect_uri` 错误 | `volc-sso` 浏览器流本地端口回调偶发失败 | 改用 `--no-browser` 跨设备流登录 |
| 某账号百分比 100% | 该账号月度/周度配额已用完 | 换账号或等重置（重置时间见对应行） |
