---
description: openspec change 上游引用审计（校验 change 不脱离上游、不越界）
---

按 and-openspec-upstream-audit skill 执行任务。

先加载 and-openspec-upstream-audit skill（用 skill 工具，ID 为 and-openspec-upstream-audit），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

