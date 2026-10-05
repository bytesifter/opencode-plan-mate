---
name: and-verify
version: 0.1.0
description: "feature 侧开发后验证（执行入口=当前会话 worktree，单 skill，AI 自主执行）：在有代码修改的当前会话 worktree（feature 分支或游离态，非 master）内，校验分支携带的 change 全部完成后，完成验证闭环——固化（游离态先落 feature/<change> 分支，再提交本次代码修改）→ 同步主干（merge master）→ 冲突解决（业务逻辑判定，尽可能 AI-native：无冲突自动解决、有冲突停下交人工）→ 部署目标环境（三态：无运行时产物记「未执行」，不阻断）→ 分层测试（unit 本地 / 系统内+e2e 环境）→ 生成测试报告（dev-notes/test-reports/<feature>/，供 and-integrate 合并门禁消费）→ 推送 feature 分支。执行入口为当前会话 worktree（非 master；master 会话拒绝），操作对象为当前 worktree。当开发者完成一轮开发、需要验证并推送可合并分支时使用。反触发：master 侧合并/归档（走 and-integrate）、环境看管与其他/无会话游离态固化（走 and-local-governance）、普通 git 操作。"
metadata:
  requires:
    bins: [git, python, openspec]
---

# and-verify 开发后验证（执行入口=当前会话 worktree · 先合并后验证 · 冲突看业务逻辑）

本 skill 是 **feature 侧开发后验证的唯一入口**：在**有代码修改的当前会话 worktree（非 master，feature 分支或游离态）**内，把一轮开发收口为「已固化、含最新主干、已验证、已推送」的可合并分支，并产出分层测试报告供 `and-integrate` 合并门禁消费。

**执行入口 vs 操作对象**：执行入口 = 当前会话所在的 **worktree（非 master；`feature/<change>` 或游离态）**；操作对象 = **当前 worktree**。

**验证标准权威源**：`references/verify-standards.md`（skill 内部唯一权威，随 skill 分发，定义执行入口、验证闭环、冲突判定、部署驱动、报告体例）。
**共享引擎**：`../_shared/worktree_ops_gate.py`（执行入口门禁判定）。

## 硬边界

- **执行入口**：仅当当前会话位于**非 master** 的 worktree（`feature/<change>` 或游离态）时执行；master 会话 SHALL 拒绝并报告「验证须在非 master worktree 执行」。固化归属决策（分支状态 × 会话归属）唯一权威见 `dev-notes/requirements/restructure-ops-skills/README.md` R7。
- **隐含前提**：当前 worktree 有代码修改（本次开发产物）；无代码修改时停下报告，不空跑。
- **固化范围**：只固化**当前 worktree** 的代码修改；**游离态先落 `feature/<change>` 分支**再提交；其他会话 / 无会话的游离态固化归 `and-local-governance`。
- **先合并后验证**：先 merge master（可信基线）再验证，保证「测试通过的内容 = 最终要合并的内容」。
- **冲突判定**：以业务逻辑为判定依据、尽可能 AI-native——无业务冲突自动解决，有业务冲突停下交人工（AI 给建议），SHALL NOT 自动决定语义冲突解法。
- **部署驱动（三态）**：集群变更经项目部署入口（规则见 `../_shared/references/deploy-contract.md`）；无运行时产物 → 不适用（记「未执行」）；有产物但入口缺失 / 部署失败 → 阻塞（停）。
- **执行上下文强制锁定**：[禁止] 使用无目录 git 命令；全部 git 命令 SHALL 显式 `git -C <目录>`。
- **只产测试报告**：本 skill 只产分层测试报告；环境治理报告归 `and-local-governance`、集成收口报告归 `and-integrate`。
- **git 拒绝即停**：[禁止] `git push --force`；git 命令失败 SHALL 停下报告。

## 执行步骤

### Step 0 门禁（当前会话 worktree 执行入口）

1. 从当前会话获取会话 ID 与所在 worktree 目录。
2. 判定执行入口（固化归属决策唯一权威见 `dev-notes/requirements/restructure-ops-skills/README.md` R7）。用 `python ../_shared/worktree_ops_gate.py --dir <目录>` 作机械门禁（该模块判 master 拒绝——本 skill 语义相反：非 master 放行，含游离态）：

| 当前会话 worktree 状态 | 放行 | 动作 |
|----------------------|------|------|
| `master` | 否 | 停下，报告「验证须在非 master worktree 执行」 |
| `feature/<change>` | 是 | 继续 |
| 游离态（`detached`） | 是 | 继续；固化第一步落 `feature/<change>` 分支（见 Step 1） |

3. 无代码修改（工作区干净且无本次迭代提交）→ 停下报告。
4. **change 完整性前置门禁**：用 `_shared` 确定性取分支携带的 changes，再逐个判完整性：

```bash
python ../_shared/worktree_branch_changes.py --dir <当前 worktree> --base master
# 对输出中每个 change：
python ../_shared/worktree_merge_check.py --dir <当前 worktree> --change <change名> --completeness-only
```

   `incomplete > 0` → **停下**，报告「change <名> 未完成（n/m 任务待办），完成后重跑」；全部 `complete` → 继续 Step 1。

### Step 1 固化（当前 worktree）

```bash
# 游离态（detached）先落分支；feature 分支跳过本行
git -C <worktree> switch -c feature/<change>
# 仅当有改动则提交（幂等）
git -C <worktree> add -A
git -C <worktree> diff --cached --quiet || git -C <worktree> commit -m "<message>"
```

- 游离态落分支名取 `feature/<关联 change>`（分支已存在则用 `git -C <worktree> switch <分支>`）。
- commit message 基于本轮开发主题化总结；不满意可 `--amend`。
- 固化只针对当前 worktree 的代码修改。

### Step 2 同步主干

```bash
git -C <当前 worktree> merge master --no-edit
```

- master 是绝对验证过的可信基线，先合入让冲突尽早暴露在验证之前。

### Step 3 冲突解决（业务逻辑判定）

- 无业务冲突的机械冲突 → 尝试自动解决，继续。
- 有业务冲突的语义冲突 → **停下**，给出解决建议，交人工解决；[禁止] 自动决定解法。

### Step 4 部署（三态）

先判结局，再据态行动：

- **不适用**（无运行时产物，无可部署对象）→ 报告记「未执行」，**继续 Step 5**。
- **执行**（有运行时产物 + 项目已声明部署入口）→ 取**当前分支名（剥 `feature/`）**作部署 seed（`git -C <当前 worktree> branch --show-current`），驱动项目部署入口（传参形态随入口声明）：

```bash
# 驱动项目声明的部署入口（示例：项目提供 deploy 编排）
<项目部署入口> <env> <seed>      # seed = 当前分支名（剥 feature/）
```

  集群变更经入口、seed / 命名空间约定见 `../_shared/references/deploy-contract.md`。
- **执行失败**（有运行时产物但项目未声明部署入口 / 部署失败）→ 报告记「部署失败」，后续环境层测试记「未执行」，**继续**（不阻断）。

[禁止] 把「不适用」当作「阻塞」中断闭环；[禁止] 把「部署失败」当作硬停（少用阻断——能走到报告就走到报告）。

### Step 5 测试（分层·三态）

- `unit`（本地零依赖）[必须]；`integration`（目标环境）/ `e2e`（目标环境，按需）。
- 按 `./norms/AGENTS-test.md` §一 分层执行。
- 某层**不适用**（如无环境 / e2e 按需未跑）→ 报告记「未执行」，**继续**，不阻断闭环。

### Step 6 生成测试报告

- 落 `dev-notes/test-reports/<feature>/`：`unit-report.md` / `integration-report.md` / `e2e-report.md`。
- 每份含：用例数 / 通过 / 失败 / 覆盖率 / 关键风险；失败字段格式 `失败：<数字>`；未执行记「未执行」。
- 报告生成后 [必须] 将验证产物（冲突解决结果 + 分层测试报告）一并提交到当前分支，使 `dev-notes/test-reports/<feature>/` 随分支入库、证据留存。

### Step 7 提交并推送分支

```bash
# 若存在未提交的验证产物（报告 / 冲突解决结果）则提交（幂等）
git -C <当前 worktree> add -A
git -C <当前 worktree> diff --cached --quiet || git -C <当前 worktree> commit -m "test: <change> 验证产物"
git -C <当前 worktree> push -u origin <当前分支>
```

- 推送失败 → 停下报告（[禁止] `--force`）；推送成功后分支（含验证产物）供 `and-integrate` 合并门禁消费。

## 停止纪律（少用阻断 · 无异常不停止）

无异常时连续执行、不停顿，**少用阻断**（能走到报告就走到报告）：

- **停下（目标塌）**：门禁不过（master 会话 / 无代码修改 / 关联 change 未完成）；语义冲突（交人工）；推送失败 / git 写命令失败；调用者显式中断。
- **记账 + 继续（落报告对应区）**：部署失败 / 入口缺失（有产物）→ 记「部署失败」+ 环境层「未执行」；部署「不适用」→ 记「未执行」；测试失败 / 未执行 → 记录；commit 无改动 → 跳过。
- [禁止] 使用 `--force`。

## 标准驱动

- 执行入口、验证闭环、冲突判定、部署驱动、报告体例 SHALL 运行时引用 `references/verify-standards.md`（skill 内部唯一权威，随 skill 分发）。
- 分层测试与报告落点遵循 `./norms/AGENTS-test.md` §一 / §三。

## 反触发

- master 侧合并 / 归档 / M 链收口 → `and-integrate`，不在本 skill 范围。
- 环境看管 / **其他与无会话**游离态固化 / 会话回收 → `and-local-governance`，不在本 skill 范围。
- 普通 git 操作（改文件、rebase 等）不涉及开发后验证 → 不触发本 skill。

## 与共享模块的协作边界

- 执行入口门禁经 `../_shared/worktree_ops_gate.py` 判定（只读）。
- 本 skill 负责编排、冲突判定、部署驱动、报告生成与推送。
