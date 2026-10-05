# and-local-governance 环境看管标准（skill 内部权威）

本文档是 `and-local-governance` skill 的**行为标准唯一权威**：定义项目级**本地环境看管 + 游离态固化**的判定规则。本文件随 skill 分发（位于 `skills/and-local-governance/references/`），skill 运行时直接引用本文件执行，不依赖项目规范体系。

**边界**：本 skill 只做本地环境看管（盘点 / 清理 / 回收 / 报告）与**游离态固化**；feature 态固化归 `and-verify`，feature→master 合并、master 收口提交（M 链）、变更归档归 `and-integrate`。本文件 SHALL NOT 定义 feature 态固化或合并规则。

## 一、定位与加载

- 归属：skill 内部参考文件（随 `and-local-governance` skill 分发）
- 执行入口：**master worktree**（非 master 会话拒绝）
- 操作对象：项目全部 worktree / feature 分支 / 会话（含游离态，`git -C <目录>` 定向）
- 加载条件：执行 `and-local-governance` 时加载
- 边界：本文件只收环境看管约定；`openspec/specs/and-local-governance` 仅保留采用声明与指针

## 二、双信号模型

[必须] 处置判定以双信号驱动；判定机制（会话活跃计算、处置分类、git 判定命令）的权威实现与契约见 `../_shared/references/classify-contract.md`（本文件不复述实现细节）：

1. **代码对象**（分支/worktree）由 **git 状态**驱动：分支已合并 master + 工作区干净 = 代码终端态，直接清理，[禁止] 因会话未闲置而推迟代码对象清理。
2. **会话对象**由**会话闲置时间**驱动：会话 `time_updated` 距今超过 `session_idle_days`（默认见 `./norms/agents-defaults.yaml`）视为过期。会话对话内容对 git 不可见，闲置时间是其「没有新内容」的代理信号。

## 三、游离态固化（本 skill 拥有的固化）

[必须] 对**其他会话 / 无会话的游离态**（`detached`，无 checkout 分支）有未提交工作或未入主干提交的对象执行固化链：提交未提交工作 → 落分支（`git -C <目录> switch -c feature/<候选名>`）→ 合并 master→feature 同步 → 推送远端。**当前会话所在的游离态不在此列**（归 `and-verify`，见本 §末段）。

[必须] 游离态视为 feature 分支的前置状态（opencode 先建 HEAD 型 worktree，分支是固化产物），落分支是核心动作；但落分支的归属按**会话**切——当前会话的游离态由 `and-verify` 落分支，本 skill 只对其他会话 / 无会话的游离态落分支（决策表唯一权威见 `dev-notes/requirements/restructure-ops-skills/README.md` R7）。

[必须] 固化操作通过 `git -C <目录>` 定向执行，[禁止] 依赖 shell 当前工作目录执行任何 git 命令。

[推荐] commit message 基于关联会话内容主题化总结（一句话）；不满意可 `git commit --amend`。

[禁止] 本 skill 对 **feature 态**（有 checkout 分支）或**当前会话所在的游离态**的 worktree 执行固化——两者固化均归 `and-verify`。遇此类脏对象 [必须] 保留、报告（不删除、不落分支、不提交），报告显式给出「归 and-verify 固化」指引。

## 四、代码对象终端态清理

[必须] 对「分支已合并 master + 工作区干净 + change 非 in-progress（或孤儿已合并）」的代码对象执行清理：`git worktree remove <目录>` → `git branch -d <分支>`。git 状态足以判定代码终端态，[禁止] 因会话未闲置推迟代码对象清理。

[必须] 游离态纯残留（干净 + HEAD 已入 master）在会话过期/无会话时清理；会话仍活跃时保留沙箱。

[必须] 清理代码对象时 [必须] **兜底**回收其**派生环境（namespace）**：经项目部署入口的 `clean` 类命令回收（seed = 被清理对象的分支）。**主回收在 `and-integrate` 合并该分支时执行**（见其 `references/integration-standards.md`），本 skill 兜底防漏。集群操作与 seed / 命名空间约定见 `../../_shared/references/deploy-contract.md`。回收点与 worktree / 分支退役同点；未声明部署入口 → 跳过并记原因。

## 五、会话闲置回收与未合并对象

[必须] 会话 `time_updated` 距今超过 `session_idle_days` 的过期会话：其代码工作已固化后 [必须] 删除会话（先固化后回收）；活跃会话（阈值内）[必须] 保留。会话删除不可逆，删除前 [必须] 保证代码工作已入 git。

[必须] 「先固化后回收」前提仅适用于回收会删除代码载体（worktree/分支）的场景；纯会话回收（仅删除会话记录，不删除任何 worktree/分支，如 master 非当前会话与游离会话）无代码损失，[必须] 豁免该前提。

[必须] master worktree 上的非当前会话与游离会话（`location.directory` 为空或不属于任何 git worktree）[必须] 纳入会话闲置驱动治理：闲置超阈值 → 回收（仅删会话记录），活跃 → 保留。master worktree 对象保持自保护。执行治理的当前会话 [必须] 无条件保留（会话 id 级保护）。

[必须] 对未合并 master 的分支：分支 [必须] 保留（change in-progress → 迭代在飞；否则待合并 pending_merge，**合并门禁与 feature→master 合并归 `and-integrate`**）；其沙箱与会话按会话闲置判定回收（recycle：回收沙箱+会话，保留分支）。

## 六、change 状态门控

[必须] 以 openspec change 状态门控**分支**处置：change in-progress → 其关联分支 [禁止] 清理（迭代在飞）；complete / archived → 分支可进入终端态 / 待合并判定。孤儿对象（无 change）按代码状态判定（已合并=完成可清理，未合并=待合并保留），会话仍按 §五 闲置单独判定。

> change 归档（complete + 分支已合并/无分支 → `openspec archive`）归 `and-integrate`（见其 `references/integration-standards.md`）；本 skill 只标注分支可清理/待合并，不执行归档。

## 七、停止纪律（少用阻断）

[必须] 无异常时连续执行、不停顿等待确认；仅在「目标塌」时停下：

1. **单对象 git 命令失败**（删脏 worktree 被拒、删 checkout 中分支被拒）→ 该对象停、报告，**继续其他对象**
2. 治理标准未覆盖某对象 → 停下报告，[禁止] 自行臆断标准执行删除
3. 调用者显式中断

[必须] **环境回收（ns clean）失败 → 记原因，继续**（不阻断治理链）。

[禁止] 使用 `git branch -D`、`git worktree remove --force` 等强制手段绕过 git 拒绝。合并冲突与归档错误由 `and-integrate` 处理，不在本 skill 范围。

## 八、报告要求

[必须] 每次治理产出**环境治理报告**并落盘，含两部分。[必须] 报告**分两次写同一文件**：**总览节**在动手前先落盘 → 固化/清理 → **结果节**动手后补落（保证「会话删除前总览已在盘上」）：

1. **项目总览**：每 change/对象一行（change 状态 / 分支合并 / 沙箱 / 会话活跃或闲置 + 建议动作），含孤儿区；回答"做到哪 / 做完没 / 合并没 / 会话闲没闲"。
2. **动作结果**：游离态固化（目录 / 分支 / 提交 hash / 合并同步 / 推送）、清理（代码终端态：worktree / 分支 / 会话）、**环境回收（派生 ns）**、回收（会话闲置 recycle；纯会话回收）、保留（对象 + 原因）、卡死（对象 + 原因 + 建议）、异常（停止点 + 原因）、待合并（分支清单，交 `and-integrate` 门禁判定）。

报告作为证据留存，[必须] 独立于被删除的会话存在。报告落盘至项目根 `dev-notes/governance/`（迭代层治理报告子域，见 `./norms/AGENTS-docs.md` §1.8），文件名 `<YYYYmmdd-HHMMSS>.md`。

## 默认值

- `session_idle_days`：见 `./norms/agents-defaults.yaml`（会话闲置阈值；运行时读取）
- 报告目录：**`dev-notes/governance`**（master worktree 根下相对路径；skill 内置）

[推荐] 执行时可按需手动输入覆盖（如 `--idle-days <天数>`）。

**最后更新**：2026-10-05
**版本**：1.1
**相关文件**：../SKILL.md（执行步骤）、../_shared/references/classify-contract.md（双信号模型机制）、./norms/AGENTS-docs.md（§1.8 四层分层）
