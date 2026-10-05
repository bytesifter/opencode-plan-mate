---
name: and-integrate
version: 0.1.0
description: "master 侧集成收口（执行入口=master worktree，唯一写主干的 skill）：对开发完成、已推送的 feature 分支执行收口闭环——① 合并门禁判定（消费 and-verify 产出的 dev-notes/test-reports/<feature>/ 与 test-plans，档位分治 + G3 测试完整性「计划承诺→报告兑现」）② feature→master 合并（--no-ff）③ 变更归档（openspec archive）④ master 收口提交与发布（仅本次运行产物；领先则发布）⑤ master 集成验证（部署 master + 完整测试 unit/系统内/e2e → 报告，非门禁）。执行入口为 master worktree（非 master 会话拒绝），操作对象为 feature 分支 / master / change。执行入口与操作对象分离；合并冲突停下交人工、门禁未过不合并、归档报错记异常继续。当需要把已验证分支并入主干并归档 change 时使用。反触发：feature 侧开发后验证（走 and-verify）、环境看管与游离态固化 + 会话回收（走 and-local-governance）、普通 git 操作。"
metadata:
  requires:
    bins: [git, python, openspec]
---

# and-integrate 集成收口（执行入口=master worktree · 门禁 → 合并 → 归档 → 收口提交与发布 → 集成验证）

本 skill 是 **master 侧集成收口的唯一入口**，也是**唯一写主干的 skill**：对开发完成、已推送的 feature 分支执行「合并门禁 → feature→master 合并 → 归档 → 收口提交与发布 → master 集成验证」闭环。

**执行入口 vs 操作对象**：执行入口 = **master worktree**；操作对象 = feature 分支（合并）、master（收口提交）、change（归档）。

**集成标准权威源**：`references/integration-standards.md`（skill 内部唯一权威，随 skill 分发，定义门禁判据、合并、归档、收口提交与发布、报告）。
**共享引擎**：`../_shared/worktree_merge_check.py`（合并门禁 G3 判定）、`../_shared/worktree_inventory.py`（盘点 changes / master 脏）、`../_shared/worktree_gate.py`（执行入口门禁 G1，`inventory → gate → classify`）、`../_shared/worktree_classify.py`（处置判定）。

## 硬边界

- **执行入口**：仅当当前会话 checkout 在 **master** 分支时执行；非 master 会话 SHALL 拒绝并报告「集成须在 master worktree 执行」。
- **执行上下文强制锁定**：[禁止] 使用无目录 git 命令；全部 git 命令 SHALL 显式 `git -C <目录>`。
- **门禁先行**：feature→master 合并前 [必须] 执行合并门禁判定；门禁未过 [禁止] 合并，未过原因记报告。
- **合并冲突**：`git merge` 冲突 SHALL 停下报告冲突文件清单，经确认后按其方案解决，[禁止] 自动决定冲突解法。
- **归档门控**：change in-progress [禁止] 归档；complete 但分支未合并 master [禁止] 归档；`openspec archive` 报错 → 停下报告。
- **收口提交与发布**：提交仅限**本次运行产物**（归档产物 + 集成报告）；HEAD 领先 `origin/master` → 发布；两者解耦。锚点为提交信息锚点（取自本轮处理对象），in-progress change 不门控。
- **git 拒绝即停**：[禁止] `--force` / `branch -D` / `worktree remove --force`；git 命令失败 SHALL 停下报告。
- **只产集成报告**：本 skill 产集成收口报告；测试报告归 `and-verify`、环境治理报告归 `and-local-governance`。

## 执行步骤

### Step 0 门禁（master 执行入口）

1. 从当前会话获取会话 ID（`OPENCODE_SESSION_ID`）、projectID 与执行入口目录。
2. 走共享门禁管线校验执行入口（master 侧 G1，`inventory → gate`）：

```bash
python ../_shared/worktree_inventory.py --project <projectID> --master-dir <master 目录> --json \
  | python ../_shared/worktree_gate.py --stdin --session <OPENCODE_SESSION_ID> --idle-days <session_idle_days> \
  > <gated.json>
```

3. 检查 `gate.allowed`：`false` → **停下**，报告 `gate.reason`（非 master / 游离态报告「集成须在 master worktree 执行」）。

### Step 1 盘点与合并门禁

```bash
python ../_shared/worktree_classify.py --inventory <gated.json> --idle-days <session_idle_days>
```

- 从 classify 输出取 `pending_merge` 对象；`archives` 仅作初筛，归档资格在 Step 3 合并后复判（见 D12）。
- 对每个待合并分支的**每个携带 change**执行门禁（多 change 分支需逐个判）：
```bash
python ../_shared/worktree_merge_check.py --dir <feature worktree> --change <change名>
```
- `allowed=false` → 停下该对象合并，`reasons` 记入报告「未合并（原因）」区。
- `allowed=true` → 进入 Step 2。
- AI 层语义判定（脚本无法判定的项：文档豁免有效性、技术方案完整性、config 一致性）记录进报告。
- **未完成 change 显式报因**：classify 对含 `in-progress` change 的分支标 `keep`、不 `pending_merge`（迭代在飞）。从 classify 的 `objects` 中找出「未合并（`merged_to_master=false`）且 `changes` 含 `status=in-progress`」的分支，逐条记入报告「未合并（原因）」区（原因：`change <名> 未完成`），[禁止] 静默跳过。

### Step 2 feature→master 合并

```bash
git -C <master worktree> merge feature/<分支> --no-ff --no-edit
```

- **合并只做本地**：发布统一在 Step 4 收口末步（单发布点），合并后 [禁止] 立即 push。
- **合并后回收派生 ns**：[必须] 合并某 feature 分支后，调 `<项目部署入口> clean <env> <分支>` 回收其派生 namespace（seed = 该分支；集群操作与 ns 约定见 `../_shared/references/deploy-contract.md`）。未声明部署入口 → 记原因跳过（不阻断）。
- 冲突 → 停下报告冲突文件清单，交人工；[禁止] 自动决定解法。

### Step 3 变更归档

```bash
openspec archive <change> -y
```

- 归档资格 [必须] 在 Step 2 合并**之后重新判定**：complete 且关联分支「当前」已合并 master（含本轮 Step 2 刚合并的分支）或无关联分支。
- [禁止] 沿用 Step 1 `classify.archives` 合并前快照的 `archive_ready`（未合并分支在快照中必为 false，会导致本轮刚合并的 change 当轮不归档）。合并后重新盘点/复判（重跑 inventory+classify，或直接以当前 master 判定各 complete change 的关联分支合并态）。
- 归档产物（archive/ 移动 + spec 合并）进入收口提交（**本次产物**）范围。

### Step 4 master 收口提交与发布（仅本次产物）

- **范围校验**：收口前看 `git -C <master worktree> status --porcelain`；改动 [必须] 仅限**本次运行产物**（归档产物 + 集成报告）。若出现**超出本次产物的改动**（master 历史滞留 / 他人改动）→ **停下报告**，不擅自纳入本次提交。
- **收口提交（仅本次产物）**：只 `git add` 本次产物路径（如 `openspec/specs`、`openspec/changes/archive`、`dev-notes/governance`），[禁止] 裸 `git add -A` 扫全工作区；本次无产物则跳过提交。message 锚定本轮处理对象。
- **发布由「领先」决定**：`git -C <master worktree> rev-list --count origin/master..master` > 0 → `git -C <master worktree> push origin master`。提交与发布**解耦**——`merge --no-ff` 本身是提交、合并后工作区可能干净，发布 [禁止] 挂靠在「脏」上（否则合并推不出去）。
- **锚点是提交信息锚点、非硬门控**：来源 = 本轮 Step 2/Step 3 处理的对象；[禁止] 以 post-archive `openspec list` 作锚点/门控（归档把 complete 移出 `changes/`，锚点自毁）。
- **in-progress change 不门控**：[禁止] 以 change 的 in-progress 状态门控收口（master 上的 in-progress 残留不阻断）。
- 任一 git 命令失败 → 停下报告，[禁止] `--force`。

### Step 5 master 集成验证（部署 master + 完整测试 · 非门禁）

因镜像**从推送的代码构建**，本步在推送之后执行，置于收口**末步**（Step 4 收口提交与发布之后）：

```bash
# 部署 master（seed=master；集群变更与 ns 约定见 ../_shared/references/deploy-contract.md）→ 完整测试
<项目部署入口> <env> master
# 完整测试：unit + 系统内 + e2e（三层全跑）
```

- **完整测试** = unit + 系统内 + e2e，**三层全跑、不因单分支轮次收窄**；产出**集成验证报告**，落 `dev-notes/test-reports/<master>/`。
- **非门禁**：失败 [禁止] 阻断收口、[禁止] 自动回滚；失败**仅出报告**，由报告驱动**新迭代**。
- 项目未声明部署入口 → 跳过并记原因。

### Step 6 报告

- 产出集成收口报告，落 `dev-notes/governance/`，文件名 `<YYYYmmdd-HHMMSS>.md`。
- 含：合并结果、归档结果、收口提交与发布结果、**master 集成验证结果**、未合并（原因）区。

## 停止纪律（少用阻断 · 无异常不停止）

无异常时连续执行、不停顿，**少用阻断**：

- **停下（目标塌）**：非 master 会话（门禁不过）；合并冲突（交人工）；git 命令失败（merge / push / commit）；调用者显式中断。
- **记账 + 继续（落报告对应区）**：合并门禁未过 → 不合并该对象记原因；`openspec archive` 报错 → 记「异常」继续；集成验证失败 → 出报告不阻断；标准未覆盖某对象 → 记原因跳过。
- [禁止] 使用 `--force`。

## 标准驱动

- 门禁判据（档位分治 / G3 测试完整性）、合并、归档、收口提交与发布、master 集成验证、报告 SHALL 运行时引用 `references/integration-standards.md`（skill 内部唯一权威，随 skill 分发）。
- 归档钩子遵循 `./norms/AGENTS-openspec.md` §三；测试证据遵循 `./norms/AGENTS-test.md` §三。

## 反触发

- feature 侧开发后验证 / 固化 / 推送 → `and-verify`，不在本 skill 范围。
- 环境看管 / 游离态固化 / 清理回收 / 会话回收 → `and-local-governance`，不在本 skill 范围。
- 普通 git 操作（改文件、rebase 等）不涉及集成收口 → 不触发本 skill。

## 与共享模块的协作边界

- 门禁判定经 `../_shared/worktree_merge_check.py`（只读确定性判定）+ AI 层语义判定。
- 执行入口门禁经 `../_shared/worktree_gate.py` G1 判定（只读，`inventory → gate`）。
- 盘点经 `../_shared/worktree_inventory.py` / `worktree_classify.py`（只读）。
- 本 skill 负责编排、合并、归档、收口提交与发布、报告。
