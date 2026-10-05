---
description: 规范体系自审计：当用户要检查/审计/体检 AGENTS-*.md 规范体系（八维度：归属与加载、交叉引用、边界与重复、内部一致性、可执行性、元数据、语言政策、时效性）时使用。只读审计，确定性项由脚本检查、语义项由 AI 判定，输出可分维度定位的问题清单。反触发：审计项目设计文档（走 and-design-system-audit）、代码 vs 设计（走 and-implementation-audit）、change 上游（走 and-openspec-upstream-audit）、技术文章（走 and-validate-article）。
---

按 and-norm-audit skill 执行任务。

先加载 and-norm-audit skill（用 skill 工具，ID 为 and-norm-audit），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

