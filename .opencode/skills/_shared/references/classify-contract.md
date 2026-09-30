# 处置判定引擎契约（worktree_classify.py）

本文件是 `worktree_classify.py` 的处置判定口径契约，供 AI 引用核对，不内嵌默认常量。

## 双信号模型

- **代码对象**（分支/worktree）由 git 状态驱动：已合并 master + 工作区干净 = 代码终端态
- **会话对象**（对话内容对 git 不可见）由会话闲置时间驱动：`time_updated` 距今 > `session_idle_days` = 会话过期
- 固化无条件：有可固化内容（未提交/游离未入主干提交）即固化，不等会话过期或 change 状态

## 处置类型

| 处置 | 判定 | 动作（skill 执行） |
|------|------|------|
| `solidify` | 有未提交工作，或游离态有未入主干提交（无条件，每次治理）；**或 master 工作区脏 + 项目级无 in-progress change + 存在 complete/archived change 锚点**（`master_commit=true`） | 固化链：提交 → 游离态落分支 → 合并 master→feature 同步 → 推送；**master 分支走 M 链：先落盘报告 → add -A → commit 到 master（message 引用锚点 change 主题）→ push origin master** |
| `cleanup` | 代码终端态：分支已合并+干净+change 非 in-progress（或孤儿已合并）；游离纯残留（干净+HEAD 已入 master + 会话过期/无会话） | 删 worktree + 删分支（+ 会话） |
| `recycle` | 未合并干净分支 + 会话过期/无会话；**或纯会话对象**（master 非当前会话 / 游离会话）闲置超阈值 | 删 worktree+会话（保留分支）；**纯会话回收仅删会话**（豁免先固化后回收，见「纯会话对象」） |
| `keep` | 执行入口自保护 / 当前会话（会话 id 级） / change in-progress 分支 / 未合并干净+会话活跃 / 非 feature 分支 / 游离纯残留+会话活跃 / 纯会话对象活跃 | 保留，报告原因 |
| `stuck` | 合并冲突未解决（dirty + in_merge） | 卡死，不处置，需人工介入 |
| `pending_merge` | 未合并干净分支（keep/recycle 的标注位） | 待合并（建议交审核），治理不执行 feature→master 合并 |

判定依据：spec「双信号驱动模型」「change 状态门控处置」「固化逻辑（无条件）」「代码对象终端态清理」「会话闲置回收」「未合并对象处置」「合并边界」。

## 判定规则

- **判定顺序**（每 worktree）：
  1. 执行入口（is_master）→ 干净 `keep`；**脏时按 master 工作区提交判定：有 in-progress change → keep「迭代在飞」；无 in-progress 且有 complete/archived 锚点 → `solidify`（`master_commit=true`）；无锚点 → keep「不臆断提交」**
  2. 合并冲突（dirty + in_merge）→ `stuck`
  3. **固化层（无条件）**：未提交工作或游离未入主干 → `solidify`
  4. **代码终端态层（git 驱动，不等会话）**：游离纯残留（会话过期/无）→ `cleanup`；分支已合并+干净+非 in-progress（或孤儿已合并）→ `cleanup`
  5. **change 门控**：in-progress → `keep`（分支保留）
  6. **未合并干净分支**：会话活跃 → `keep` + pending_merge；会话过期/无 → `recycle` + pending_merge
- **纯会话对象**（第三类对象，`object_type="session"`）：worktree 与 feature 分支循环之后单独判定，仅 `keep`/`recycle` 两态——
  1. 当前会话（`gate.current_session` 会话 id 级）→ `keep`（无条件保护，即使闲置超阈值）
  2. master 目录非当前会话（`category="master"`）→ 闲置判定
  3. 游离会话（`category="orphan"` 或 directory 空 / 不属于任何 git worktree）→ 闲置判定
  - 非 master worktree 会话（`category="attached"`）不重复成行，由 worktree 对象处置
  - 闲置超阈值 → `recycle`（**纯会话回收**：仅 `opencode session delete`，不删 worktree/分支，豁免「先固化后回收」前提）；活跃 → `keep`
  - master worktree 对象保持 `keep` 且不再挂接会话（master 会话独立成行，解除 first-wins）
- **会话活跃判定**：`session_active(session)` = time_updated 距今 < `session_idle_days`（毫秒>10^12 自动转秒）；缺失/异常时间戳视为过期
- **孤儿分支**（无 change）：已合并 → 代码终端态 cleanup；未合并 → keep/recycle + pending_merge
- **游离态**：视为 feature 前置状态（落分支核心动作）；有提交未入主干 → solidify（落分支保提交）
- **change 归档判定**（第四类对象，`archives` 字段，供 skill Step 5a 归档执行）：
  - 仅 `inventory.changes` 中 `status=complete` 的 change 进入归档判定；in-progress 等非 complete 不标
  - 关联分支（`correlations.change_to_branch` 的 branch）已合并 master（复用 `feature_branches[].merged_to_master`，缺失回退 git `merged_into_master`）或无关联分支 → `archive_ready: true`（可归档）
  - 关联分支未合并 master → `archive_ready: false` + `pending_merge: true`（待合并，建议交审核，归档等待分支合入）
  - 判定数据复用 inventory 已有字段，不新增数据源

## git 命令约束

全部 git 命令显式 `git -C <目录>` 锁定：分支已合并判定用 `-C <master_dir>`，游离 HEAD 祖先判定用 `-C <worktree_dir>`。

## 输入输出

- 输入：项目盘点 JSON（inventory 输出，含 `git_worktrees[].dirty/in_merge/is_master/merged_to_master`、`sessions[].time_updated`、`correlations.change_to_branch`）
- `--idle-days`：会话闲置阈值（默认 15，SKILL 从 `./norms/agents-defaults.yaml` §worktree_governance 读取传入，本模块不内嵌常量）

```
{
  objects: [
    {
      object_type: "worktree" | "branch" | "session",
      directory, branch, detached, dirty, in_merge,
      is_master, active_session, session_id,
      change, change_status,      # 关联 change 及状态（孤儿为 null）
      orphan: bool,
      merged_to_master,           # None 未判定 / bool
      disposal: "solidify"|"cleanup"|"recycle"|"keep"|"stuck",
      reason: string,
      pending_merge: bool,         # 待合并（建议交审核）
      master_commit: bool          # master 工作区提交（solidify 且 is_master 时为 true，skill 走 M 链）
    }
  ],
  archives: [                      # change 归档判定（第四类对象，供 skill Step 5a）
    {
      change: string,              # change 名
      status: "complete",          # 仅 complete 进入（in-progress 不标）
      branch: "feature/<change>" | null,   # 关联分支（无则 null）
      merged_to_master: bool | null,       # 分支合并状态（无分支为 null）
      archive_ready: bool,         # true=可归档；false=分支未合并不归档
      pending_merge: bool,         # 分支未合并标注（待合并，建议交审核）
      reason: string
    }
  ]
}
```

- `object_type="session"`：纯会话对象（master 非当前会话 / 游离会话），`is_master=false`、`branch=""`、`merged_to_master=null`；`orphan=true` 表示游离会话；仅 `keep`/`recycle` 两态。
- `archives`：独立于 `objects` 返回（不混入 worktree/branch/session 处置），change 归档判定数据复用 inventory 已有字段（changes / change_to_branch / feature_branches.merged_to_master），不新增数据源。

## 版本记录

- 2026-09-27：初版（五类分组 + 时间维度超龄）
- 2026-09-28：治理化改造（处置判定 solidify/cleanup/keep/stuck，去除年龄阈值）
- 2026-09-28：项目锚点改造（对象状态机、change 门控、pending_merge、孤儿标注）
- 2026-09-29：双信号模型改造（会话闲置判定、固化无条件、代码终端态分治、recycle 处置）
- 2026-09-29：纯会话治理（`object_type="session"`、会话 id 级当前会话保护、纯会话回收豁免固化前提、master 对象不吸收会话）
- 2026-09-29：master 工作区提交（is_master 分支脏判定 + 项目级 change 门控 + complete 锚点 → solidify/master_commit）
- 2026-09-29：change 归档执行（archives 字段：complete + 分支已合并/无分支 → archive_ready；未合并 → pending_merge；in-progress 不标）
