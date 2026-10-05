---
name: and-local-governance
version: 0.6.0
description: "项目级本地环境看管 + 游离态固化（执行入口=master worktree，单 skill，AI 自主执行，双信号模型）：以项目（projectID）为锚点盘点关联 change / worktree / 功能分支 / 会话（含 time_updated），先落报告总览（看清：做到哪/做完没/合并没/会话闲没闲）再快速处理——游离态固化（其他/无会话的 detached worktree 有工作即落 feature 分支保工作；当前会话游离态归 and-verify）→ 代码终端态清理（已合并+干净，git 状态足够不等会话）→ 会话闲置回收（闲置超 `session_idle_days` 删会话，含 master 非当前会话与游离会话的纯会话回收）。feature 态固化与当前会话游离态固化归 and-verify、feature→master 合并与 master 收口提交（M 链）与变更归档归 and-integrate，本 skill 只做环境看管（含派生 ns 回收）与其他/无会话游离态固化：feature 态脏对象保留报告不碰，少用阻断（记账号续），治理报告落盘；标准随 skill 内部权威文件（references/governance-standards.md）。当用户要求治理/看清项目 worktree 状态、游离态收尾固化、回收本地残留与过期会话时使用。反触发：feature 侧验证与固化、当前会话游离态固化（走 and-verify）、feature→master 合并 / 归档（走 and-integrate）、worktree 创建（opencode 内置）、普通 git 操作。"
metadata:
  requires:
    bins: [git, python, opencode, openspec]
---

# and-local-governance 本地环境看管（执行入口=master · 游离态固化 · 双信号驱动）

本 skill 是**项目级本地环境看管的唯一入口**：以项目（当前会话 projectID）为锚点，一次盘点关联四类对象——openspec change / worktree / 功能分支 / 会话，**先落报告总览（动手前，看清）**再快速处理（游离态固化 → 代码终端态清理 → 会话闲置回收），最后向同一报告补落结果节。

**执行入口 vs 操作对象**：执行入口 = **master worktree**；操作对象 = 项目全部 worktree / 分支 / 会话（含游离态，`git -C <目录>` 定向）。

**职责边界**：
- 本 skill 拥有 **游离态固化**（detached worktree 落 feature 分支）与环境看管（清理/回收/报告）。
- **feature 态固化**归 `and-verify`；**feature→master 合并、master 收口提交（M 链）、变更归档**归 `and-integrate`。
- 遇 feature 态脏对象 [必须] 保留、报告（不碰内容）。

**双信号模型**（判定核心）：
- **代码对象**（分支/worktree）由 git 状态驱动：已合并 master + 工作区干净 = 代码终端态，直接清理，不等会话闲置。
- **会话对象**由会话闲置时间驱动：`time_updated` 距今 > `session_idle_days` = 会话过期。

**环境看管标准权威源**：`references/governance-standards.md`（skill 内部唯一权威，随 skill 分发）。
**默认值**：`session_idle_days` 见 `./norms/agents-defaults.yaml`（运行时读取，可经 `--idle-days` 覆盖）；报告目录默认 `dev-notes/governance`。
**共享引擎**：`../_shared/`（inventory / gate / classify，均只读判定）。

## 硬边界

- **执行入口**：仅当当前会话 checkout 在 master 分支时执行；非 master 会话 SHALL 拒绝并报告「治理需在 master worktree 执行」。
- **操作对象**：项目全部 worktree / 分支 / 会话 / **派生环境（ns）**；[禁止] 使用无目录 git 命令，全部 git 命令 SHALL 显式 `git -C <目录>`。
- **固化边界**：只固化**其他会话 / 无会话的游离态**（`detached` 且 `is_current_session == false`）worktree；[禁止] 对 feature 态 worktree 固化（归 `and-verify`）；**当前会话所在的游离态**（`is_current_session == true`）归 `and-verify`（本 skill 保留、报告，给「归 and-verify」指引）。
- **合并/归档边界**：本 skill [禁止] 执行 feature→master 合并、M 链收口、变更归档（归 `and-integrate`）；只标注分支待合并。
- **change 门控**：change in-progress 的关联**分支** SHALL NOT 清理（迭代在飞）。
- **清理只针对干净对象**：代码终端态 = 已合并 + 干净；脏对象不删。
- **会话删除不可逆**：回收会话前 SHALL 保证其代码工作已入 git（先固化后回收）；纯会话回收（仅删会话记录）豁免该前提。
- **git 拒绝即停**：[禁止] `git branch -D`、`git worktree remove --force`；git 拒绝 / 冲突 / 失败 SHALL 停下报告。
- **无异常连续执行**：治理链 SHALL 在无异常时连续执行至完成，不逐操作等待确认。

## 执行步骤

### Step 0 门禁与盘点（master 执行入口，inventory → gate G1）

1. 从当前会话上下文获取：当前会话 ID（`OPENCODE_SESSION_ID`）、projectID、执行入口目录。
2. 走共享门禁管线校验执行入口（master 侧 G1）并落盘盘点结果，供后续处置判定复用（D5/D15 单一权威，[禁止] 自行实现入口判断）：

```bash
python <本skill目录>/../_shared/worktree_inventory.py --project <projectID> --master-dir <当前会话目录> --json \
  | python <本skill目录>/../_shared/worktree_gate.py --stdin --session <OPENCODE_SESSION_ID> --idle-days <session_idle_days> \
  > <gated.json>
```

- 输出含四对象：changes / sessions / git_worktrees（dirty/detached/in_merge/is_master/merged）/ feature_branches + correlations，并含 `gate` 结果。
3. 检查 `gate.allowed`：`false` → **停下**，报告 `gate.reason`（非 master / 游离态报告「治理需在 master worktree 的会话中执行」）。

### Step 1 处置判定（调用共享模块）

```bash
python <本skill目录>/../_shared/worktree_classify.py --inventory <gated.json> --idle-days <session_idle_days>
```

- 从 `objects` 取处置。**注意职责过滤**：`solidify` 中 **feature 态（有分支）** 与 **`is_current_session == true` 的游离态** 归 `and-verify`——本 skill 只执行 **非当前会话的游离态（detached）** 的 solidify；feature 态与当前会话游离态脏对象按 `keep`（保留、报告）。

### Step 2 报告·总览节先落盘（动手前）

[必须] 在动手（固化 / 清理 / 回收）**之前**，先把报告的**总览节**落盘：将 `objects` 组织为项目总览写进 `<master worktree>/dev-notes/governance/<YYYYmmdd-HHMMSS>.md` 的「## 项目总览」节（每 change/对象一行：状态 / 合并? / 沙箱 / 会话 / 处置 / 建议动作；含孤儿区），回答「做到哪 / 做完没 / 合并没 / 会话闲没闲」。**先落盘保证「会话删除前总览已在盘上」**（报告 [必须] 独立于被删除的会话存在）。

### Step 3 游离态固化（无条件，限非当前会话）

对每个 `disposal == solidify` 且 **游离态（detached）** 的对象，按固化链连续执行（全程 `git -C <目录>`）：

```
B1 有未提交工作 -> git -C <目录> add -A && git -C <目录> commit -m "<message>"
B2 游离态     -> git -C <目录> switch -c feature/<候选名>     [落分支=核心动作]
B3 合并 master->feature 同步 -> git -C <目录> merge master --no-edit
B4 推送远端    -> git -C <目录> push -u origin <当前分支>
```

- feature 态（有分支）的 `solidify` **不执行**——归 `and-verify`，保留报告。
- **当前会话所在的游离态**（`is_current_session == true`）不固化——归 `and-verify`（由其落分支后验证）；本 skill 保留、报告，给「归 and-verify」指引。决策表唯一权威见 `dev-notes/requirements/restructure-ops-skills/README.md` R7。
- 固化只保工作入 git，不回收沙箱。

### Step 4 清理与回收

对 `disposal == cleanup` 的代码终端态对象，级联清理（**清理对象共 5 类：`change` 门控 / worktree / feature 分支 / 会话 / 环境 ns**）：

```
D1 git -C <master worktree> worktree remove <目录>   (有沙箱则删)
D2 git -C <master worktree> branch -d <分支>         (已合并分支)
D3 opencode session delete <会话 id>                 (有则删)
D4 <项目部署入口> clean <env> <分支>                  (回收该分支的派生 ns；seed=分支；见 `../_shared/references/deploy-contract.md`)
```

对 `disposal == recycle` 的对象（未合并分支 + 会话过期）：回收沙箱与会话，保留分支。对纯会话对象（master 非当前会话 / 游离会话）：仅删会话。

- **环境回收（第 5 类）**：退役 worktree / 清理 feature 分支时，[必须] **兜底**回收其派生 namespace（`clean` 类入口；seed = 被清理对象的分支；**主回收在 and-integrate 合并该分支时**）。集群操作与 ns 约定见 `../_shared/references/deploy-contract.md`；未声明部署入口 → 跳过并记原因。
- **先固化后回收**：回收/清理前保证工作已入 git；`git worktree remove` 因脏被拒 → 停下报告，不 `--force`。

### Step 5 报告·结果节补落

总览节已在 Step2 落盘；动手完成后，向**同一报告文件**补落「## 动作结果」节（游离态固化 / 清理 / **环境回收** / 回收 / 保留 / 卡死 / 异常 / 待合并清单）。报告体例见 `references/governance-standards.md` §八。

## 停止纪律（少用阻断 · 无异常不停止）

无异常时连续执行、不停顿，**少用阻断**：

- **停下（目标塌）**：非 master 会话 / 应用不符（门禁）→ 停；单对象 git 拒绝（删脏被拒 / 删 checkout 分支被拒）→ 该对象停、继续其他对象；标准未覆盖某对象 → 停、不臆断；调用者显式中断。
- **记账 + 继续**：环境回收（ns clean）失败 → 记原因继续。
- [禁止] 使用 `-D` / `--force` 绕过 git 拒绝。

> 合并冲突、合并门禁未过、归档报错由 `and-integrate` 处理，不在本 skill 范围。

## 标准驱动

- 双信号模型、游离态固化、清理、回收、change 分支门控、报告要求 SHALL 运行时引用 `references/governance-standards.md`（skill 内部唯一权威）。
- 双信号模型机制（会话活跃计算、处置分类）指针引用 `../_shared/references/classify-contract.md`。
- 可迭代默认值：`session_idle_days` 见 `./norms/agents-defaults.yaml`（运行时读取）；报告目录默认 `dev-notes/governance`；执行时可手动覆盖。

## 反触发

- feature 侧开发后验证、feature 态固化、**当前会话游离态固化** → `and-verify`，不在本 skill 范围。
- feature→master 合并 / master 收口提交（M 链）/ 变更归档 → `and-integrate`，不在本 skill 范围。
- worktree 创建（`git worktree add`）→ opencode 内置，不处理。
- 普通 git 操作（改文件、rebase 等）不涉及环境看管 → 不触发本 skill。
- 非当前项目（其他 projectID）的对象 → 不处理。

## 与共享模块的协作边界

- 盘点 / 门禁 / 处置判定全部经 `../_shared/` 模块执行（只读判定），本 skill 负责编排、项目总览与写操作执行。
- 契约文档：`../_shared/references/`（inventory / gate / classify-contract）。
