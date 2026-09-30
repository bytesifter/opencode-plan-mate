---
description: 技术文章校验（多源独立评审，发布前自检）
---

按 and-validate-article skill 执行任务。

先加载 and-validate-article skill（用 skill 工具，ID 为 and-validate-article），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

