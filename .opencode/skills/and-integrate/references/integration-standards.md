# and-integrate 集成收口标准（skill 内部权威）

本文档是 `and-integrate` skill 的**行为标准唯一权威**：定义 master 侧集成收口的判定规则——合并门禁、feature→master 合并、master 收口提交与发布、变更归档。本文件随 skill 分发（位于 `skills/and-integrate/references/`），skill 运行时直接引用本文件执行，不依赖项目规范体系。

**边界**：本 skill 是唯一写主干的 skill；环境看管与游离态固化归 `and-local-governance`，feature 侧验证与固化归 `and-verify`。

## 一、定位与加载

- 归属：skill 内部参考文件（随 `and-integrate` skill 分发）
- 执行入口：**master worktree**（非 master 会话拒绝）
- 操作对象：feature 分支（合并）、master（收口提交）、change（归档）、环境 ns（合并后回收）
- 加载条件：执行 `and-integrate` 时加载
- 边界：本文件只收集成收口约定；`openspec/specs/and-integrate` 仅保留采用声明与指针

## 二、执行入口与操作对象

[必须] 执行入口为 master worktree；非 master 会话 [必须] 拒绝并报告。[必须] 全部 git 命令显式 `git -C <目录>` 锁定。

## 三、合并门禁判据（G1-G3，档位分治）

[必须] feature→master 合并前执行合并门禁判定，按 **change 是否含「代码实现」任务**分档（三类任务归类见 `./norms/AGENTS-test.md` §四.1），档位由 `_shared/worktree_merge_check.py` 确定性输出：

- **档位 1（基础质量）**：无代码实现任务。判据：**change 任务完整性（`tasks.md` 任务全勾，由 `worktree_merge_check.py` 的 `task_completeness` 确定性判定）** + 文档差异或豁免 + config 目录结构一致 + config 协议技术栈一致。
- **档位 2（+ 测试完整性）**：含代码实现任务。档位 1 判据 + **G3 测试完整性**。

[必须] change 任务完整性（`tasks.md` 任务全勾）由 `worktree_merge_check.py` 确定性判定，**两档共用**；有未勾选任务即阻断（`reasons` 含「change 任务未完成」）。

### G3 测试完整性判据（计划承诺 → 报告兑现）

[必须] 按「测试计划承诺 → 测试报告兑现」逐层判定（unit / integration / e2e），数据源为 `dev-notes/test-plans/<feature>/`（事前方案）与 `dev-notes/test-reports/<feature>/`（事后证据，见 `./norms/AGENTS-test.md` §三）：

| 层状态 | 计划声明「需要该层」 | 计划声明「不需要该层」 |
|--------|---------------------|------------------------|
| 报告存在 + 0 失败 | 通过 | 通过（超承诺，不拦） |
| 报告存在 + 有失败 | 阻断：有失败 | 通过（层未承诺） |
| 报告缺失 / 记「未执行」 | 阻断：承诺未兑现 | 通过（按需豁免） |

[必须] 测试计划缺失（`test-plans/<feature>/` 无声明）→ 视为声明全部三层需要，缺失即阻断。

[必须] e2e 豁免由 change 测试计划声明决定，[禁止] 门禁硬编码「e2e 不阻断」。

[必须] 门禁未过 → [禁止] 合并，[必须] 将未合并原因（`reasons`）记入报告「未合并（原因）」区，不阻断其他对象。

## 四、feature→master 合并

[必须] 对合并门禁通过的对象，在 master worktree 执行 `git -C <master> merge feature/<分支> --no-ff --no-edit`（**合并只本地，发布统一在 §六 收口末步**）。[必须] 合并后回收该分支派生 ns（`<项目部署入口> clean <env> <分支>`；集群操作与 ns 约定见 `../../_shared/references/deploy-contract.md`）。

[必须] 合并冲突（`git merge` 冲突）→ 停下报告冲突文件清单（`git -C <master> diff --name-only --diff-filter=U`），经确认后按其方案解决并重新合并，[禁止] 自动决定冲突解法。

## 五、变更归档

[必须] 归档资格 [必须] 在 feature→master 合并**之后重新求值**——complete 且关联分支「当前」已合并 master（含本轮刚合并的分支）或无关联分支，方可执行 **openspec 归档流程**（`openspec archive <change>`：change 移入 archive/ + spec delta 合并进主 spec）。[禁止] 沿用合并前 `classify.archives` 快照的 `archive_ready`。归档动作前质量判据已由合并门禁核验，openspec 工具原生 validate 作第二道防线。

[必须] 归档触发门控：change in-progress [禁止] 归档；complete 但关联分支未合并 master [禁止] 归档（先走门禁合并）。`openspec archive` 报错 → 停下报告，[禁止] 跳过检查强行归档。

## 六、master 收口提交与发布

[必须] 收口按「提交」与「发布」两件独立的事判定——收口（merge / archive / commit / push）视为一次**原子事务**：合并只本地，发布统一在收口末步。

**提交（仅本次运行产物）**：[必须] 收口提交范围限定**本次运行产物**（归档产物 + 集成报告）；[禁止] 用裸 `git add -A` 扫全工作区。[必须] 收口前校验工作区改动仅限本次产物；出现超出本次产物的改动（master 历史滞留 / 他人改动）→ 停下报告，不擅自纳入。[禁止] 以 change 的 in-progress 状态门控收口——master 上的 in-progress change [禁止] 阻断收口。

**发布（由「领先」决定）**：[必须] 当 `git -C <master worktree> rev-list --count origin/master..master` > 0 时，`git -C <master worktree> push origin master`。[必须] 与提交解耦：`merge --no-ff` 本身是提交、合并后工作区可能干净，故发布 [禁止] 挂靠在「提交」条件上（否则合并推不出去）。

[必须] 锚点是**提交信息锚点**，[禁止] 作硬门控：来源 = 本轮 Step 2 / Step 3 处理的对象（本轮已知）。[禁止] 以 post-archive 的 `openspec list` 作锚点或门控——`openspec archive` 把 complete change 移出 `changes/`（进 `archive/`，不再被 list），据此判定会自毁锚点、导致收口永不收敛。

[必须] 提交链任一 git 命令失败（add / commit / push）→ 停下报告进入「异常」，[禁止] 使用 `--force` 重推。master worktree 目录自身保持自保护（执行入口，永不清理），提交仅针对工作区代码。

## 七、停止纪律（少用阻断）

[必须] 仅在「目标塌」时停下；其余失败 [必须] 记账后尽量走到报告：

**停下（目标塌）**：
1. 合并冲突（停下报告冲突文件清单，经确认后解决，[禁止] 自动决定解法）
2. git 命令失败（merge / push / commit 报错）
3. 调用者显式中断

**记账 + 继续（不阻断收口，落报告对应区）**：
- 合并门禁未过 → 不合并该对象，记原因
- `openspec archive` 报错 → 记「异常」，继续收口（不跳过检查强行归档）
- 集成验证失败 → 出报告，不阻断收口
- 集成标准未覆盖某对象 → 记原因、跳过该对象

## 八、报告要求

[必须] `and-integrate` 产出**集成收口报告**（合并 / 归档 / 收口提交与发布 / **master 集成验证**结果 + 未合并原因），落盘至项目根 `dev-notes/governance/`，文件名 `<YYYYmmdd-HHMMSS>.md`。报告作为证据留存，[必须] 独立于被删除的会话存在。

**未合并（原因）区**只列门禁拦下的质量类原因（测试计划/报告缺失、任务未勾完、文档豁免失效、config 不一致），每分支可多项；原因来源 `worktree_merge_check.py` 判定结果 + AI 层语义判定。git 状态类（未推送 / 未提交工作 / 游离）由各 skill 的固化链自愈，[禁止] 列为未合并原因。

## 九、master 集成验证（收口末步，接 §六 收口提交与发布之后）

[必须] 在 feature→master 合并、归档、收口提交与发布**之后**，[必须] 对 master 执行**集成验证**：经项目部署入口部署 master（seed=`master`）并运行**完整测试**（unit + 系统内 + e2e，三层全跑）。集群变更与 seed / 命名空间约定见 `../../_shared/references/deploy-contract.md`。

[必须] **三层全跑、不因单分支轮次收窄**——集成测试是发现「多变更集成问题」的唯一手段；与 `and-verify` 的重复部署 / 测试代价接受。

[必须] 集成验证置于收口**末步**；因镜像**从推送的代码构建**，部署必在推送之后。

[禁止] 集成验证失败阻断收口或自动回滚；失败**仅产出集成验证报告**，由报告驱动**新迭代**。

[必须] 集成验证报告落 `dev-notes/test-reports/<master>/`（分层三份）；其结论摘要并入 §八 集成收口报告。

**最后更新**：2026-10-05
**版本**：1.2
**相关文件**：../SKILL.md（执行步骤）、../_shared/worktree_merge_check.py（门禁判定）、./norms/AGENTS-openspec.md（归档钩子）、./norms/AGENTS-test.md（§三 测试计划/报告）
