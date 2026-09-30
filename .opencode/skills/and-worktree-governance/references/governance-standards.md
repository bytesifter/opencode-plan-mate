# and-worktree-governance 项目 worktree 治理标准（skill 内部权威）

本文档是 `and-worktree-governance` skill 的**行为标准唯一权威**：定义项目级 worktree 治理的判定规则——双信号模型、change 状态门控、固化/清理/回收标准、合并边界、停止纪律与报告要求。本文件随 skill 分发（位于 `skills/and-worktree-governance/references/`），skill 运行时直接引用本文件执行治理，不依赖项目规范体系。

## 一、定位与加载

- 归属：skill 内部参考文件（随 `and-worktree-governance` skill 分发）
- 加载条件：执行 `and-worktree-governance` 治理时加载
- 边界：本文件只收治理约定（skill 私有执行标准）；`openspec/specs/and-worktree-governance` 仅保留采用声明与指针，不复述行为正文

## 二、双信号模型

[必须] 以双信号驱动处置：

1. **代码对象**（分支/worktree）由 **git 状态**驱动：分支已合并 master + 工作区干净 = 代码终端态，直接清理，[禁止] 因会话未闲置而推迟代码对象清理。
2. **会话对象**由**会话闲置时间**驱动：会话 `time_updated` 距今超过 `session_idle_days`（默认 15）视为会话过期。会话对话内容对 git 不可见，闲置时间是其「没有新内容」的代理信号；git 状态不足以证明会话无新内容，[禁止] 凭代码终端态直接删除活跃/未过期会话。master 非当前会话与游离会话（无 worktree 归属，含空目录）同样按闲置时间驱动治理（纯会话回收），处置口径见 §五。

## 三、固化标准（无条件）

[必须] 对「有未提交工作，或游离态有未入主干提交」的对象执行固化链：提交未提交工作 → 游离态落分支（`git -C <目录> switch -c feature/<候选名>`）→ 合并 master→feature 同步 → 推送远端。

[必须] 固化**无条件执行**：有可固化内容即固化（每次治理都做），[禁止] 等待会话过期或 change 状态。

[必须] 游离态视为 feature 分支的前置状态（opencode 先建 HEAD 类型 worktree，分支是固化产物），落分支是核心动作。

[必须] 固化操作通过 `git -C <目录>` 定向执行，[禁止] 依赖 shell 当前工作目录执行任何 git 命令。

[推荐] commit message 基于关联会话内容总结生成（主题化一句话）；执行后不满意可 `git commit --amend` 事后修改。

[必须] **master 工作区提交**（master worktree 收口提交，与游离/feature 固化并列）：当 master 工作区存在未提交改动时，按三重门控判定——①master 脏；②项目级无 in-progress change（存在任一 in-progress 视为迭代在飞，master 不收口）；③存在终结 change 锚点（`inventory.changes` 中 complete/archived 状态，多个取清单首个）。三条件全满足时执行提交链：**先落盘治理报告**（报告随本次提交入库，不记录本次提交 hash）→ `git -C <master worktree> add -A` → commit 到 master（message 格式 `governance: <关联 change 主题> master 收口`）→ `push origin master`。

[必须] master 提交以关联 change 为语义锚点：有 complete/archived change 才提交（有业务上下文），[禁止] 无 change 锚点时臆断提交 master 主干。提交链任一 git 命令失败（add/commit/push）→ 停下报告进入「异常」，[禁止] 使用 `--force` 重推。master worktree 目录自身保持自保护（执行入口，永不清理），提交仅针对工作区代码。

## 四、代码对象终端态清理

[必须] 对「分支已合并 master + 工作区干净 + change 非 in-progress（或孤儿已合并）」的代码对象执行清理：`git worktree remove <目录>` → `git branch -d <分支>`。git 状态足以判定代码终端态，[禁止] 因会话未闲置推迟代码对象清理；脏则先固化（先固化后清理）。

[必须] 游离态纯残留（干净 + HEAD 已入 master）在会话过期/无会话时清理；会话仍活跃时保留沙箱。

## 五、会话闲置回收与未合并对象

[必须] 会话 `time_updated` 距今超过 `session_idle_days` 的过期会话：其代码工作已固化后 [必须] 删除会话（先固化后回收）；活跃会话（阈值内）[必须] 保留（可能产生 git 不可见的新内容）。会话删除不可逆，删除前 [必须] 保证代码工作已入 git。

[必须] 「先固化后回收」前提仅适用于回收会删除代码载体（worktree/分支）的场景；纯会话回收（仅删除会话记录，不删除任何 worktree/分支，如 master 非当前会话与游离会话）无代码损失，[必须] 豁免该前提，直接按闲置时间回收。

[必须] master worktree 上的非当前会话（`location.directory` 指向 master worktree 且非执行入口会话）与游离会话（`location.directory` 为空，或不属于任何 git worktree）[必须] 纳入会话闲置驱动治理：闲置超 `session_idle_days` → 回收（仅删除会话记录，不删除 worktree/分支），活跃 → 保留。master worktree 对象保持自保护（执行入口，永不删除），但其上的非当前会话 [禁止] 因该对象保护被连带豁免。执行治理的当前会话 [必须] 无条件保留（会话 id 级保护），即使闲置超阈值 [禁止] 删除。

[必须] 对未合并 master 的分支：分支 [必须] 保留（change in-progress → 迭代在飞；否则待合并 pending_merge，交审核）；其沙箱与会话按会话闲置判定回收（recycle：回收沙箱+会话，保留分支）。

## 六、change 状态门控

[必须] 以 openspec change 状态门控**分支**处置：change in-progress → 其关联分支 [禁止] 清理（迭代在飞）；complete / archived → 分支可进入终端态 / 待合并判定。孤儿对象（无 change）按代码状态判定（已合并=完成可清理，未合并=待合并保留），会话仍按 §五 闲置单独判定。

[必须] **change 归档执行**（change 生命周期闭环，治理动作）：complete 状态 change 且其关联分支已合并 master（或无关联分支）→ 执行 **openspec 归档流程**——归档前按 `./norms/AGENTS-openspec.md` §二 归档钩子表逐项核验 5 项前置检查（master 分支项由治理门禁天然满足），通过后 `openspec archive <change>` 归档（change 移入 archive/ + spec delta 合并进主 spec）。归档产物（archive/ 移动 + spec 合并）纳入「master 工作区提交」M 链收口入库。

[必须] 归档触发门控：change in-progress [禁止] 归档（迭代在飞）；complete 但关联分支未合并 master [禁止] 归档（待合并，建议交审核，归档等待分支合入后由下次治理执行）。归档前置 5 项检查任一未过或 `openspec archive` 报错 → 停下报告进入「异常」，[禁止] 跳过检查强行归档。归档动作本身属 openspec 流程，本文件只收治理口径，5 项检查正文见 `./norms/AGENTS-openspec.md` §二（主题单一权威，不复述）。

## 七、合并边界与停止纪律

[必须] feature→master 合并不是本治理职责（审核能力，人守出口）：治理 [禁止] 执行 feature→master 合并，[必须] 将「待合并」分支作为建议动作列于总览与报告，交审核流程处理。固化链内「合并 master→feature 同步主干」是治理动作，在范围内。

[必须] 仅在以下情形停下并报告，其余情形无异常连续执行、不停顿等待确认：

1. git 命令失败（删脏 worktree 被拒、删 checkout 中分支被拒、其他命令报错）
2. 合并冲突（停下报告冲突文件清单，经确认后按其方案解决并重新合并，[禁止] 自动决定冲突解法）
3. 归档前置检查未过或 `openspec archive` 报错（停下报告未过项/错误，[禁止] 跳过检查强行归档）
4. 治理标准未覆盖某对象（停下报告，[禁止] 自行臆断标准执行删除）
5. 调用者显式中断

[禁止] 使用 `git branch -D`、`git worktree remove --force` 等强制手段绕过 git 拒绝。

## 八、报告要求

[必须] 每次治理产出治理报告并落盘，含两部分：

1. **项目总览**：每 change/对象一行（状态摘要：change 状态 / 分支合并 / 沙箱 / **会话活跃或闲置** + 建议动作），含孤儿区；回答"做到哪 / 做完没 / 合并没 / 会话闲没闲"。
2. **动作结果**：固化（分支 / 提交 hash / 合并同步 / 推送）、清理（代码终端态：worktree / 分支 / 会话）、回收（会话闲置 recycle：沙箱 / 会话 / 保留分支；纯会话回收：master/游离会话仅删会话记录）、保留（对象 + 原因）、卡死（对象 + 原因 + 建议）、异常（停止点 + 原因）、**待合并（建议交审核）**清单。

报告作为证据留存，[必须] 独立于被删除的会话存在。

[必须] 报告落盘至项目根 `dev-notes/governance/`（迭代层治理报告子域，见 `./norms/AGENTS-docs.md` §1.8），文件名 `<YYYYmmdd-HHMMSS>.md`；master 收口提交（M 链）场景下报告先落盘、随 master 提交入库（见 §三 master 工作区提交）。

## 默认值（skill 内置）

治理默认值作为 skill 内置常量，不依赖项目配置文件：

- `session_idle_days`：**15**（会话闲置阈值，`time_updated` 距今超过即视为会话过期）
- 报告目录：**`dev-notes/governance`**（master worktree 根下相对路径）

[推荐] 执行治理时可按需手动输入覆盖（如经 `--idle-days <天数>` 参数传入闲置阈值），未输入时使用上述内置默认值。


**最后更新**：2026-09-30
**版本**：0.8
**相关文件**：../SKILL.md（执行步骤）、./norms/AGENTS-docs.md（§1.8 四层分层）、./norms/AGENTS-openspec.md（归档钩子表 §二）、../openspec/specs/and-worktree-governance（采用声明指针）
