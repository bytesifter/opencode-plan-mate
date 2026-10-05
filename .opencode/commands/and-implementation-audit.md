---
description: and-implementation-audit 程序项目实现侧审计：对照真实代码与设计声明的自洽性。从四类声明源（openspec/config.yaml、规范 AGENTS-*.md、架构文档、技术方案）运行时抽取声明与规则清单，双向对照代码证据（目录树/包结构/依赖/import/格式化工具），输出自洽/空头设计/无依据/跑偏四种判定态的只读报告。当用户要检查/审计/体检一个程序项目的实现是否落地设计、代码结构/依赖/命名与设计声明是否一致时使用。反触发：审计 openspec change 是否满足上游设计（走 and-openspec-upstream-audit）、审计设计文档体系（走 and-design-system-audit）、校验技术文章（走 and-validate-article）。
---

按 and-implementation-audit skill 执行任务。

先加载 and-implementation-audit skill（用 skill 工具，ID 为 and-implementation-audit），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

