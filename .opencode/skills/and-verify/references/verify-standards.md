# and-verify 验证标准（skill 内部权威）

本文档是 `and-verify` skill 的**行为标准唯一权威**：定义 feature 侧开发后验证的判定规则——固化、同步主干、冲突解决、部署、分层测试、报告、推送。本文件随 skill 分发（位于 `skills/and-verify/references/`），skill 运行时直接引用本文件执行，不依赖项目规范体系。

**边界**：本 skill 在**当前会话所在 worktree（非 master；`feature/<change>` 或游离态）**内执行；**其他会话 / 无会话的游离态**固化与环境看管归 `and-local-governance`，feature→master 合并、master 收口提交（M 链）、变更归档归 `and-integrate`。

## 一、定位与加载

- 归属：skill 内部参考文件（随 `and-verify` skill 分发）
- 执行入口：**当前会话所在 worktree（非 master）**（`feature/<change>` 或游离态；master 会话拒绝）
- 操作对象：**当前 worktree**（游离态先落 `feature/<change>` 分支；隐含前提：有代码修改）
- 加载条件：执行 `and-verify` 时加载
- 边界：本文件只收验证约定；`openspec/specs/and-verify` 仅保留采用声明与指针

## 二、执行入口与操作对象

[必须] 执行入口为当前会话所在 worktree（非 master；`feature/<change>` 或游离态）；当前会话位于 master worktree 时 [必须] 拒绝并报告「验证须在非 master worktree 执行」。操作对象为当前 worktree（游离态先落 `feature/<change>` 分支）。[必须] 全部 git 命令显式 `git -C <目录>` 锁定。

[必须] 执行入口放行后、进入验证闭环前，[必须] 先判 **change 完整性前置门禁**：当前分支携带的 changes（命名匹配 `feature/<change>` ∪ 分支相对 master 的 diff 命中 `openspec/changes/<name>/`）**全部 `complete`**（`_shared/worktree_merge_check.py` 确定性判定，`--completeness-only`）。存在未完成 → [必须] 停下报告「change <名> 未完成（n/m 任务待办），完成后重跑」；[禁止] 对未完成 change 继续验证或推送。

## 三、验证闭环流程

[必须] 按以下顺序执行验证闭环：

```
1. 固化      游离态先 git switch -c feature/<change> 落分支；再 git -C <当前 worktree> add -A && commit（提交本次代码修改；message 主题化）
2. 同步主干  git -C <当前 worktree> merge master --no-edit
3. 冲突解决  见 §四
4. 部署      驱动项目声明的部署入口（见 §五），部署当前分支到目标环境
5. 测试      按分层执行（unit 本地 / integration+e2e 环境；见 §六）
6. 报告      产出分层测试报告（见 §六）
7. 提交并推送 先提交验证产物（冲突解决结果 + 分层测试报告），再 git -C <当前 worktree> push -u origin <当前分支>
```

**为何先合并再验证**：master 是绝对验证过的可信基线，先合入让冲突尽早暴露在验证之前，保证「测试通过的内容 = 最终要合并的内容」。

[必须] 每个步骤的结局按**三态**判定（不是新增固定步骤，而是每步行动前先判其结局）：

| 结局 | 条件 | 动作 |
|------|------|------|
| 执行 | 该步骤对本次变更有内容可做 | 执行并在报告记录结果 |
| 不适用 | 该步骤对本次变更无内容（如无运行时产物 → 部署 / 系统内 / e2e 无对象；e2e 按需未跑） | 报告记「未执行」，**继续**下一步 |
| 阻塞 | **目标依赖该步骤**且做不成（无它则「可合并分支 + 证据」目标不成立） | 停下报告 |

[必须] 「不适用」[禁止] 被当作「阻塞」——不得因某步骤无内容而中断整个闭环（含报告与推送）。

[必须] 固化只提交**当前 worktree** 的代码修改；**当前会话所在的游离态**由本 skill 先落 `feature/<change>` 分支再提交；**其他会话 / 无会话的游离态**固化归 `and-local-governance`。

[必须] 验证产物（冲突解决结果 + 分层测试报告）[必须] 在推送前提交进当前分支，使 `dev-notes/test-reports/<feature>/` 成为分支的一部分（证据留存 + 远端可消费），[禁止] 以未提交状态推送。

## 四、冲突解决判定（业务逻辑锚定，尽可能 AI-native）

[必须] 同步主干（merge master）产生冲突时，以**业务逻辑**为判定依据、尽可能 AI-native：

- 经判定**无业务冲突**的机械冲突（重命名 / 格式 / 无重叠改动）→ [必须] 尝试自动解决，继续验证流程。
- 经判定**有业务冲突**的语义冲突（同一逻辑区域双方修改）→ [必须] 停下、给出解决建议并交人工解决，[禁止] 自动决定语义冲突解法。

原则：尽可能 AI-native，但不是完全 AI-native；判定锚定业务逻辑，业务冲突由人拍板。

## 五、部署驱动

[必须] 集群变更类操作（集群部署 / 应用部署 / 应用升级）[必须] 经**项目声明的部署入口**；测试验证类访问（读状态 / 探针 / 日志）可直连。规则与 seed / 命名空间约定的**单一权威**见 `../../_shared/references/deploy-contract.md`，本文件不复述。

[必须] 部署前 [必须] 派生**部署 seed = 当前分支名（剥 `feature/`）**（`git -C <当前 worktree> branch --show-current`），随部署入口驱动一并传入。

[必须] 项目未声明部署入口时，按 §七 三态判定：有运行时产物 → 阻塞（停下报告）；无运行时产物 → 不适用（记「未执行」，继续）。

## 六、分层测试与报告体例

[必须] 按 `./norms/AGENTS-test.md` §一 分层执行测试，报告落 `dev-notes/test-reports/<feature>/`（§3.2）：

| 层 | 文件 | 运行位置 |
|----|------|---------|
| 单元 | `unit-report.md` | 本地（零依赖） |
| 系统内 | `integration-report.md` | 目标环境 |
| 端到端 | `e2e-report.md` | 目标环境（按需） |

- 每份报告含：用例数 / 通过 / 失败 / 覆盖率 / 关键风险。
- 报告「失败」字段格式为 `失败：<数字>`（供 `and-integrate` 门禁解析）；未执行阶段的标记 [必须] 用以下之一（与 `_shared/worktree_merge_check.py` 的 `NOT_EXECUTED_MARKERS` 一致）：`未执行` / `未跑` / `not executed`。
- 这三份报告 SHALL 作为 `and-integrate` 合并门禁（G3 测试完整性）的输入。

## 七、停止纪律（少用阻断）

[必须] 仅在「**目标塌**」时停下并报告；其余失败 [必须] **记账后尽量走到报告**（[禁止] 因可记账的失败中断闭环）：

**停下（目标塌）**：
1. 门禁不过（master 会话 / 无代码修改 / 关联 change 未完成）
2. 语义冲突（停下给出建议，交人工）
3. 推送失败 / git 写命令失败（分支不可用、交付不出）
4. 调用者显式中断

**记账 + 继续（不阻断闭环，落报告对应区）**：
- 部署失败 / 部署入口缺失（有运行时产物）→ 记「部署失败」，后续环境层测试记「未执行」
- 部署「不适用」（无运行时产物）→ 记「未执行」
- 某层测试失败 / 未执行 → 报告记录
- commit 无改动 → 跳过

## 八、报告要求

[必须] `and-verify` 产出分层测试报告（§六），落 `dev-notes/test-reports/<feature>/`。不产出环境治理报告（归 `and-local-governance`）或集成收口报告（归 `and-integrate`）。

**最后更新**：2026-10-04
**版本**：1.0
**相关文件**：../SKILL.md（执行步骤）、./norms/AGENTS-test.md（§三 测试计划/报告）、./norms/AGENTS-docs.md（§1.8 四层分层）
