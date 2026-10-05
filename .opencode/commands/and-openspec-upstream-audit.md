---
description: openspec change 上游引用审计：规范驱动，运行时经项目根 AGENTS.md 定位规范体系并抽取细化链（层数 / 各层定义 / 文档落点 / 缺位规则），校验新生成的 openspec change 是否沿细化链逐层细化且不超出既有设计边界。当用户要检查/审计一个 openspec change 的上游引用完整性、确认 change 没有脱离上游凭空产生或越界时使用。覆盖三层——L1 引用完整性（确定性脚本）、L2 结构质量（AI 判断四维：存在/清晰/粒度）、L3 一致性核查（AI：偏差/越界），只读报告不自动修改。反触发：审计存量 change、文档现实对齐（change↔代码）、审计设计文档体系（走 and-design-system-audit）、校验技术文章格式（走 and-validate-article）不在此 skill。
---

按 and-openspec-upstream-audit skill 执行任务。

先加载 and-openspec-upstream-audit skill（用 skill 工具，ID 为 and-openspec-upstream-audit），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

