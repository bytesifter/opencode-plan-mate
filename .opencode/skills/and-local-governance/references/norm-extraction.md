# 环境看管标准引用说明（and-local-governance 标准驱动）

本文件说明 skill 如何引用环境看管标准，供 AI 引用核对。

## 引用链

```
skill 内部标准（唯一权威）:
  skills/and-local-governance/references/governance-standards.md
    -> 环境看管标准正文：
       - 双信号模型（§二）：机制指针 ../_shared/references/classify-contract.md
       - 游离态固化（§三）：detached worktree 有工作即落 feature 分支
       - 代码终端态清理（§四）：已合并 master 或游离纯残留 + 工作区干净
       - 会话闲置回收（§五）：time_updated 距今 > session_idle_days
       - change 状态门控（§六）：in-progress 不清理分支
       - 停止纪律（§七）
       - 报告要求（§八）
  -> 数据源：openspec `list --json`（盘点模块已取）
  -> 默认值：skill 内置（session_idle_days=15、报告目录 dev-notes/governance），执行时可经
     `--idle-days` 等参数手动输入覆盖
```

## 引用规则

- 治理开始前 SHALL 先引用 skill 内部标准；标准文件缺失或引用失败 → 停下报告「标准缺失」，不臆断标准。
- 处置判定遵循**双信号模型**：代码对象按 git 状态（已合并+干净=终端态）；会话对象按 `session_idle_days` 闲置时间。机制见 `../_shared/references/classify-contract.md`。
- 固化**仅对游离态**（detached）：有可固化内容即固化（落 feature 分支保工作）；**feature 态固化归 `and-verify`**，本 skill 遇 feature 态脏对象保留报告。
- **feature→master 合并、master 收口提交（M 链）、变更归档归 `and-integrate`**；本 skill 只在报告中标注分支「待合并」，不执行门禁/合并/归档。
- 孤儿对象（无 change 关联）按代码状态判定；会话仍按闲置单独判定。
- `openspec/specs/and-local-governance` 仅保留采用声明与指针，不复述行为正文。

## 版本记录

- 2026-09-28：初版
- 2026-09-28：项目锚点改造（对象状态机、change 门控、合并边界、openspec 数据源）
- 2026-09-30：标准收进 skill 内部（权威源改为 references/governance-standards.md）
- 2026-10-03：合并能力（合并门禁自动执行、G3 测试完整性判据）
- 2026-10-04：职责收窄（游离态固化 + 环境看管；合并/归档/M 链移出到 `and-integrate`，feature 态固化移出到 `and-verify`）
