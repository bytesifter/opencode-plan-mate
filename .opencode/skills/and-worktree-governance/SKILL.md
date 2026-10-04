---
name: and-worktree-governance
version: 0.5.0
description: "项目级 worktree 治理（单 skill，AI 自主执行，双信号模型）：以项目（projectID）为治理锚点，一次盘点关联 openspec change / worktree / 功能分支 / 会话（含 time_updated），先出项目总览（看清：做到哪/做完没/合并没/会话闲没闲）再快速处理——固化无条件（有可固化内容每次治理就固化，含游离态落分支）→ 合并门禁自动执行（pending_merge 门禁过即 feature→master 合并，未过记未合并原因；检查在 feature worktree 侧执行）→ 代码终端态清理（已合并+干净+change 完成态，git 状态足够不等会话）→ 会话闲置回收（>15 天删会话，含 master 非当前会话与游离会话的纯会话回收——仅删会话、豁免先固化、当前会话 id 级保护；对话内容 git 不可见故以闲置时间为代理）；change 状态门控分支（in-progress 不清理）；git 拒绝即停，治理报告落盘；标准随 skill 内部权威文件（references/governance-standards.md）。当用户要求治理/看清项目 worktree 状态、收尾固化、自动合并已完备 change、回收残留与过期会话、快速对齐并行迭代时使用。反触发：worktree 创建（opencode 内置）、合并冲突解法（人工介入）、普通 git 操作。"
metadata:
  requires:
    bins: [git, python, opencode, openspec]
---

# and-worktree-governance 项目治理（锚点=项目 · 总览先行 · 双信号驱动）

本 skill 是**项目级 worktree 治理的唯一入口**：以项目（当前会话 projectID）为治理锚点，一次盘点关联四类对象——openspec change / worktree / 功能分支 / 会话，**先出项目总览（只读，看清）**再快速处理（固化 → 代码终端态清理 → 会话闲置回收），最后产出治理报告落盘。

**双信号模型**（本 skill 的判定核心）：
- **代码对象**（分支/worktree）由 git 状态驱动：已合并 master + 工作区干净 = 代码终端态，直接清理，不等会话闲置。
- **会话对象**（对话内容对 git 不可见）由会话闲置时间驱动：`time_updated` 距今 > `session_idle_days` = 会话过期，回收沙箱/会话；闲置时间是其"没有新内容"的代理信号。

**治理标准权威源**：`references/governance-standards.md`（skill 内部唯一权威，随 skill 分发，运行时引用双信号模型 / change 门控 / 合并边界 / 停止纪律 / 报告要求）。
**默认值**：skill 内置（`session_idle_days` 默认 15、报告目录默认 `dev-notes/governance`），执行时可经 `--idle-days` 等参数手动输入覆盖，不依赖项目配置。
**共享引擎**：`../_shared/`（inventory / gate / classify 三模块 + references 契约，均只读判定）。

## 硬边界

- **项目锚点**：治理对象为当前项目（projectID）全部 worktree / change / 分支 / 会话，SHALL NOT 处理其他项目。
- **master worktree 唯一执行入口**：仅当当前会话 checkout 在 master 分支时执行；非 master 会话 SHALL 拒绝并说明。
- **执行上下文强制锁定**：[禁止] 使用无目录 git 命令；全部 git 命令 SHALL 显式 `git -C <目录>`。
- **合并边界**：feature→master 合并由**合并门禁通过后自动执行**（Step 5b-5c）；门禁未过 → SHALL NOT 合并，未合并原因记报告；合并冲突 SHALL 停下交人工。
- **change 门控**：change in-progress 的关联**分支** SHALL NOT 清理（迭代在飞）。
- **固化无条件**：有可固化内容 SHALL 每次治理即固化，不等会话过期。
- **会话删除不可逆**：回收会话前 SHALL 保证其代码工作已入 git（先固化后回收）；纯会话回收（仅删会话记录、不删 worktree/分支，无代码载体）豁免该前提。
- **git 拒绝即停**：[禁止] `git branch -D`、`git worktree remove --force`；git 拒绝 / 冲突 / 失败 SHALL 停下报告。
- **无异常连续执行**：治理链 SHALL 在无异常时连续执行至完成，不逐操作等待确认。

## 执行步骤

### Step 0 门禁（master 执行入口）

1. 从当前会话上下文获取：当前会话 ID（`ses_...`）与 projectID。
2. 确定执行入口目录 = 当前会话 `location.directory`；校验 `git -C <目录> symbolic-ref --short HEAD` 解析为 `master`。
3. 非 master / 游离态 → **停下**，报告"治理需在 master worktree 的会话中执行"。

### Step 1 项目盘点（调用共享模块）

```bash
python <本skill目录>/../_shared/worktree_inventory.py --project <projectID> --master-dir <当前会话目录> --json
```

- 输出含四对象：changes（openspec）/ sessions / git_worktrees（含 dirty/detached/in_merge/is_master/merged）/ feature_branches（含 merged）+ correlations（change↔分支、分支↔worktree、worktree↔会话、孤儿区）。

### Step 2 门禁检查（调用共享模块）

```bash
python <本skill目录>/../_shared/worktree_inventory.py --project <projectID> --master-dir <当前会话目录> --json \
  | python <本skill目录>/../_shared/worktree_gate.py --stdin --session <当前会话ID> --idle-days <session_idle_days>
```

- 检查 `gate.allowed`：`false` → **停下**，报告 `gate.reason`。
- 盘点完整透传（保护对象由 classify 标 keep）；`gate.excluded_dirs/branches` 供报告保留区参考。

### Step 3 处置判定（调用共享模块）

```bash
python <本skill目录>/../_shared/worktree_gate.py --inventory <gated.json> --session <当前会话ID> --idle-days <session_idle_days> \
  | python <本skill目录>/../_shared/worktree_classify.py --stdin --idle-days <session_idle_days>
```

- `session_idle_days` 为 skill 内置默认（15），执行时可经 `--idle-days` 手动输入覆盖，经该参数传入 gate 与 classify。
- 从 `objects` 取每对象的处置：`solidify`（无条件固化）/ `cleanup`（代码终端态）/ `recycle`（回收沙箱会话保留分支；**纯会话对象仅删会话**）/ `keep` / `stuck`，及 `pending_merge`、孤儿、会话闲置标注。
- 会话对象（`object_type=session`）：master 非当前会话与游离会话（directory 为空或无 worktree 归属）按闲置判定——闲置超阈值 → 纯会话回收（仅删会话），活跃 → 保留；当前会话（`gate.current_session`）无条件保留。

### Step 4 项目总览（只读，看清）

将 `objects` 组织为**项目总览**展示给用户（不落盘前先呈现），每 change/对象一行：

```
+------------------+----------+--------+---------+--------+--------+---------------+
| change/对象       | 状态     | 合并?  | 沙箱    | 会话   | 处置   | 建议动作       |
+------------------+----------+--------+---------+--------+--------+---------------+
| <change>         | in-prog  | -      | <dir>   | 活跃   | 保留   | 迭代在飞       |
| <change>         | complete | 未合并  | <dir>   | 闲置   | 回收   | 沙箱会话回收,分支走合并门禁 |
| <孤儿分支>        | -        | 未合并  | -       | -      | 保留   | 孤儿无 change,交人工决策 |
| <游离残留>        | 孤儿     | -      | <dir>   | 闲置   | 清理   | 回收           |
| <游离有工作>      | 孤儿     | -      | <dir>   | 活跃   | 固化   | 落分支保工作    |
| <当前会话>        | master   | -      | master  | 活跃   | 保留   | 执行入口保护    |
| <master 会话>     | master   | -      | master  | 闲置   | 回收   | 纯会话回收(仅删会话) |
| <游离会话>        | 游离     | -      | -       | 闲置   | 回收   | 纯会话回收(仅删会话) |
+------------------+----------+--------+---------+--------+--------+---------------+
```

- 总览回答"做到哪 / 做完没 / 合并没 / 会话闲没闲"；`pending_merge` 对象列为「待合并门禁判定」——门禁过 → 自动合并，门禁不过 → 未合并（原因）。

### Step 5a 固化逻辑（无条件）

对每个 `disposal == solidify` 的对象，按固化链连续执行（全程 `git -C <目录>`）。固化 **SHALL 无条件执行**：有可固化内容即固化（每次治理都做），SHALL NOT 等待会话过期或 change 状态。**按 `master_commit` 标记分派**：`master_commit == true` 走 M 链（master 工作区提交，见下），其余走 B 链（游离态/feature）。

**B 链（游离态 / feature 分支）**：

```
B1 有未提交工作 -> git -C <目录> add -A && git -C <目录> commit -m "<message>"
   (commit message 基于关联会话内容总结生成，主题化一句话；不满意可 git commit --amend)
B2 游离态 -> git -C <目录> switch -c feature/<候选名>     [落分支=核心动作]
   (分支名按会话内容生成 kebab-case；已有分支跳过)
B3 合并 master->feature 同步 -> git -C <目录> merge master --no-edit   [同步主干, 非收口]
   (冲突 -> 停下，见停止纪律)
B4 推送远端 -> git -C <目录> push -u origin <当前分支>（已有跟踪则普通 push）
   (推送失败 -> 停下报告)
```

**M 链（master 工作区提交，`master_commit == true`）**——master 脏且项目级无 in-progress change、存在 complete/archived change 锚点时的收口提交：

```
M0 先落盘治理报告  -> 写入 <master worktree>/dev-notes/governance/<YYYYmmdd-HHMMSS>.md
   (报告先于提交落盘，随本次提交入库；报告不记录本次提交 hash，由 git log 提供)
M1 git -C <master worktree> add -A
M2 git -C <master worktree> commit -m "governance: <关联 change 主题> master 收口"
   (关联 change = inventory.changes 中 complete/archived 的 change，多个取清单首个；主题取 change name)
M3 git -C <master worktree> push origin master
   (推送失败 -> 停下报告，见停止纪律；[禁止] --force)
```

- **合并边界**：B3 只同步主干进分支（master→feature，非收口）；feature→master 收口合并由 Step 5b-5c 门禁自动执行。
- 固化只保工作入 git，不回收沙箱；沙箱是否回收由 Step 6 会话闲置判定决定。

### Step 5b 合并门禁（feature 侧检查）

对 classify 输出中每个 `pending_merge` 对象（含 `archives` 中 `pending_merge == true` 的 complete change），执行合并门禁判定：

```
G0 门禁检查脚本：python <本skill目录>/../_shared/worktree_merge_check.py \
     --dir <feature worktree> --change <change名>
   (确定性判定：档位 1/2、G3 测试完整性「计划承诺->报告兑现」、reasons)
G1 AI 层语义判定（脚本无法判定的项）：
   - 文档差异豁免有效性（./norms/AGENTS-docs.md §三）
   - 技术方案完整性（若档位 2 纳入 G2：change design.md / docs/technical/<topic>/ 存在）
   - config 一致性（./norms/AGENTS-openspec.md §三 归档钩子表项 3/4）
   (判定依据记录进报告，保持可审计)
```

- `allowed=true` → 进入 Step 5c 自动合并。
- `allowed=false` → **停下该对象的合并**，未合并原因（脚本 `reasons` + AI 判定项）回填 `pending_merge.reasons`，记入报告「未合并（原因）」区，不执行合并。原因可修复项（补测试报告/补计划）由后续迭代处理，非永久卡死。

### Step 5c 自动合并（feature→master）

对合并门禁通过的 `pending_merge` 对象，在 master worktree 执行：

```
C1 git -C <master worktree> merge feature/<分支> --no-ff --no-edit
   (冲突 -> 停下，见停止纪律；[禁止] 自动决定冲突解法)
C2 git -C <master worktree> push origin master
   (推送失败 -> 停下报告；[禁止] --force)
```

- 合并后该 change 的 `archive_ready` 自动满足（分支已合并 master），进入 Step 5d 归档。

### Step 5d change 归档（openspec 归档流程）

对 classify 输出 `archives` 中每个 `archive_ready == true` 的 change（含 Step 5c 合并后就绪的），执行 **openspec 归档流程**（change 生命周期闭环：complete → 归档 → spec 合并进主 spec）：

```
A1 openspec archive <change> -y
   (openspec 原生流程：change 移入 archive/ + spec delta 合并进主 spec；
    质量判据已在 Step 5b 合并门禁核验，openspec 工具原生 validate 作第二道防线)
A2 结果记录进治理报告「归档」小节
```

- `openspec archive` 报错 → **停下**，报告错误，进入「异常」，保留归档现场（change 已在 archive/ 或 spec 已合并），下次治理重新盘点可见。
- 分支未合并的 complete change（`archive_ready == false` + pending_merge）→ 走 Step 5b-5c 合并门禁；门禁未过 → 不归档，未合并原因记报告，归档等待分支合入 master 后由下次治理执行。

### Step 5e master 提交（M 链收口）

Step 5d 归档产物（archive/ 移动 + spec 变更）进入 M 链 `git -C <master worktree> add -A` 范围，随 master 提交一并收口入库（M 链见 Step 5a）。

**时序**：Step 5a 固化（B 链 + M 链定义）→ Step 5b 合并门禁（feature 侧检查）→ Step 5c 自动合并（feature→master）→ Step 5d 归档（A 链，openspec 归档产物）→ Step 5e master 提交（M 链收口）。归档产物（archive/ 移动 + spec 变更）进入 M 链 `add -A` 范围随 master 提交入库。

### Step 6 清理与回收（代码终端态 + 会话闲置）

1. **重新盘点 + 门禁 + 处置判定**（复用 Step 1-3，确认固化后对象状态已更新）。
2. 对每个 `disposal == cleanup` 的**代码终端态**对象，按固定顺序级联清理（git 状态足够，不等会话闲置）：

```
D1 git -C <master worktree> worktree remove <目录>   (有沙箱则删)
D2 git -C <master worktree> branch -d <分支>         (已合并分支, 无分支归属跳过)
D3 opencode session delete <会话 id>                 (有则删)
```

3. 对每个 `disposal == recycle` 的对象（未合并分支 + 会话过期/无会话），**回收沙箱与会话，保留分支**：

```
R1 git -C <master worktree> worktree remove <目录>
R2 opencode session delete <会话 id>
   (分支保留, 待合并门禁判定/进行中, 不删)
```

4. 对每个 `disposal == recycle` 且 `object_type == "session"` 的**纯会话对象**（master 非当前会话 / 游离会话），执行**纯会话回收**（仅删会话，无 worktree/分支可删）：

```
S1 opencode session delete <会话 id>
   (豁免「先固化后回收」前提；master worktree/分支/沙箱均不动)
```

- **先固化后回收（产物守恒）**：回收/清理前保证对象工作已入 git；`git worktree remove` 因脏被拒 → 该对象转为「卡死」，停下报告，不 `--force`。纯会话回收（仅删会话记录）无代码载体，豁免该前提。
- 会话删除不可逆，删除前 SHALL 确认其代码工作已固化（对话内容 git 不可见，闲置>15 天是其"无新内容"代理）；纯会话对象无代码载体，直接按闲置判定。

### Step 7 治理报告落盘

将治理结果写入报告：`<master worktree>/dev-notes/governance/<YYYYmmdd-HHMMSS>.md`。

**报告时序**：
- **默认时序**（无 master 提交）：Step 7 末尾落盘报告。
- **master 提交场景**（存在 `master_commit == true` 对象）：报告 **M0 先落盘**（在 M1 `add -A` 之前写入），随 master 提交入库，成为版本化治理证据；报告不记录本次 master 提交的 hash（自指），hash 由 `git log` 提供。

报告含两部分（见治理规范 §六 / 报告模板）：

```
# worktree 治理报告 <时间戳>
应用: <projectID>   执行入口: <master worktree>

## 项目总览
| change/对象 | 状态 | 合并? | 沙箱 | 会话(活跃/闲置) | 处置 | 建议动作 |

## 动作结果
### 固化
| 目录 | 分支 | 提交 hash | 合并master同步 | 推送 |
### 清理（代码终端态）
| 对象类型 | 标识 | 结果 |
### 回收（会话闲置, recycle）
| 对象 | 沙箱 | 会话 | 分支(保留) |
### 纯会话回收（master/游离会话, 仅删会话）
| 类别 | 会话 | 闲置 | 结果 |
### 保留
| 对象 | 原因 |
### 卡死
| 对象 | 原因 | 建议 |
### 异常
| 停止点 | 原因 |
### 未合并（原因）
| 分支 | change | 档位 | 未合并原因 |
|------|--------|------|-----------|
| <branch> | <change> | 1/2 | <原因多项: 测试计划/报告缺失 / 任务未勾完 / 文档豁免失效 / config 不一致> |
```

## 停止纪律（git 拒绝即停 · 无异常不停止）

治理链在**无异常时连续执行、不停顿**，仅在以下情形停下并报告（记录进报告「异常」）：

- **门禁不过**：非 master 会话 / 应用不符 → 停下报告 `gate.reason`。
- **git 命令失败**：commit / merge / push / worktree remove / branch -d 任一报错 → 停下报告，不用 `-D` / `--force`。**master 提交链（M1 add / M2 commit / M3 push）任一失败同样停下报告进入「异常」，[禁止] `--force` 重推**。
- **合并门禁未过 / 归档失败**：合并门禁未过 → 停下该对象合并，未合并原因记报告；`openspec archive` 报错 → 停下报告错误，[禁止] 跳过检查强行归档。
- **合并冲突**：合并 master→feature 冲突 → 停下报告冲突文件清单（`git -C <目录> diff --name-only --diff-filter=U`），给出解决建议，经用户确认后按其方案解决并重新合并，SHALL NOT 自动决定冲突解法。
- **卡死对象**：既有未固化工作又无法清理（冲突态 / 删脏被拒）→ 停下报告，指引人工介入。
- **标准未覆盖**：skill 内部标准（references/governance-standards.md）缺失或引用失败 → 停下报告，不臆断标准执行删除。
- **调用者显式中断**：用户要求停止 → 停下报告已完成部分。

## 标准驱动

- 对象状态机（Change/Branch/Worktree/Session 到最终态）、change 门控、合并边界、报告要求 SHALL 运行时引用 `references/governance-standards.md`（skill 内部唯一权威，随 skill 分发）。
- 可迭代默认值（`session_idle_days` 默认 15、报告目录默认 `dev-notes/governance`）为 skill 内置常量，执行时可手动输入覆盖，本 skill 不依赖项目配置文件。

## 反触发

- worktree 创建（`git worktree add`）→ opencode 内置，不处理
- 合并冲突解决（feature→master 冲突的解法）→ 人工介入，治理 SHALL NOT 自动决定冲突解法
- 普通 git 操作（改文件、rebase 等）不涉及项目治理 → 不触发本 skill
- 非当前项目（其他 projectID）的对象 → 不处理

## 与共享模块的协作边界

- 盘点 / 门禁 / 处置判定 / 合并门禁判定全部经 `../_shared/` 模块执行（只读判定），本 skill 负责编排、项目总览与写操作执行
- 契约文档：`../_shared/references/`（inventory / gate / classify-contract）与 `worktree_merge_check.py`（合并门禁 G3 判定）
