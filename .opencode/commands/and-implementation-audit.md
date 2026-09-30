---
description: 实现侧审计（对照真实代码与设计声明的自洽性，四态判定只读报告）
---

按 and-implementation-audit skill 执行任务。

先加载 and-implementation-audit skill（用 skill 工具，ID 为 and-implementation-audit），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

