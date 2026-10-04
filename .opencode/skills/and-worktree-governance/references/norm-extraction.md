# 治理标准引用说明（and-worktree-governance 标准驱动）

本文件说明 skill 如何引用治理标准，供 AI 引用核对。

## 引用链

```
skill 内部标准（唯一权威）:
  skills/and-worktree-governance/references/governance-standards.md
    -> 治理标准正文：
       - 对象状态机（§三）：Change/Branch/Worktree/Session 四对象到最终态
       - change 状态门控（§六）：in-progress 不清理
       - 清理标准（§四）：已合并 master 或游离纯残留 + 工作区干净 + 无活跃会话
       - 固化标准（§三）：游离/feature + 无活跃会话 + 有未提交工作；落分支为核心动作
       - 合并边界（§七）：feature→master 合并门禁自动执行（门禁过即合并，未过记未合并原因）
       - 停止纪律（§七）：git 拒绝 / 合并冲突 / 合并门禁未过 / 标准未覆盖 / 显式中断
       - 报告要求（§八）：项目总览 + 动作结果
  -> 数据源：openspec `list --json`（change 名称与状态，盘点模块已取）
  -> 默认值：skill 内置（session_idle_days=15、报告目录 dev-notes/governance），执行时可经
     `--idle-days` 等参数手动输入覆盖
```

## 引用规则

- 治理开始前 SHALL 先引用 skill 内部标准；标准文件缺失或引用失败 → 停下报告「治理标准缺失」，不臆断标准。
- 处置判定遵循**双信号模型**：代码对象（分支/worktree）按 git 状态（已合并+干净=终端态）；会话对象按 `session_idle_days` 闲置时间（time_updated 距今 > 阈值 = 过期）。`session_idle_days` 为 skill 内置默认 15，执行时可输入覆盖，并经 `--idle-days` 传入 classify。
- 固化无条件：有可固化内容（未提交工作/游离未入主干提交）即固化，不等会话过期或 change 状态。
- 孤儿对象（无 change 关联）按代码状态判定（已合并=完成可清理，未合并=待合并门禁判定）；会话仍按闲置单独判定。
- 合并门禁（§七 G3 测试完整性）在 feature worktree 侧执行：计划承诺→报告兑现逐层判定，测试计划缺失默认需全部层；门禁未过 → 未合并原因记报告，[禁止] 合并。
- `openspec/specs/and-worktree-governance` 仅保留采用声明与指针，不复述行为正文；行为变更只维护本 skill 内部 standards，不产生 spec delta。

## 版本记录

- 2026-09-28：初版
- 2026-09-28：项目锚点改造（对象状态机、change 门控、合并边界、openspec 数据源）
- 2026-09-30：标准收进 skill 内部（权威源改为 references/governance-standards.md，默认值内置 + 输入覆盖）
- 2026-10-03：合并能力（合并边界改门禁自动执行、新增 G3 测试完整性判据、停止纪律加门禁未过）
