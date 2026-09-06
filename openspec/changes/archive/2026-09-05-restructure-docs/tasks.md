## 1. 根目录文件

- [x] 1.1 新建 `AGENTS.md`（指针式：指向用户级规范 `/home/xin-cheng/code/myagents.md/AGENTS.md` 与项目权威源 `openspec/`、`docs/`）
- [x] 1.2 删除 `AGENTS.md.bak`

## 2. docs/getting-started

- [x] 2.1 新建 `docs/getting-started/installation.md`：前置依赖、安装步骤（clone/build/plugin 指向）、完整配置表（含 `planStats.accounts`）、配置示例（轮询 + planStats）、轮询规则

## 3. docs/user-guide

- [x] 3.1 新建 `docs/user-guide/round-robin.md`：轮询机制（接入点+模型分组随机、429/402 熔断、passthrough）、`roundrobin_stats` 用法与输出示例、日志示例与含义
- [x] 3.2 新建 `docs/user-guide/plan-stats.md`：能力说明（官方 quota vs 实际用量）、前置（arkcli + 每账号独立 HOME）、`planStats.accounts` 配置、每账号两段式 SSO setup、用法与输出示例、FAQ/排障（为什么 arkcli/独立 HOME/只有 percent/未登录/100%）

## 4. docs/technical

- [x] 4.1 新建 `docs/technical/plan-stats/README.md`：背景动机、关键决策（依赖 arkcli、单身份模型→独立 HOME、accounts 映射、percent-only）、架构图（plan_stats → spawn arkcli → parse → render）、引用上游 openspec change（`add-plan-stats`、`fix-plan-stats-multi-account`）、备选方案与取舍

## 5. README 重写

- [x] 5.1 重写 `README.md` 为入口文档：标题/简介/特性（链接 docs 明细）/快速开始（3 步）/安装链接/工具速查（roundrobin_stats、plan_stats 各一句话 + 链接）/文档导航/贡献/许可证

## 6. 校验

- [x] 6.1 全库文档格式合规检查：无 `---` 分割线、标题层级严格递增、代码块标注语言、文档中文、相对链接有效（README 与 docs 互链可跳转）
- [x] 6.2 `openspec validate restructure-docs` 通过；`bun test` / `bun x tsc --noEmit` / `bun run build` 不受影响（无代码变更，跑一次确认无回归）
