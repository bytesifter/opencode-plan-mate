---
description: 【占位·未实现】发布能力（未来规划）。本 skill 尚未实现；被调用时[必须]立即停下并报告「and-release 尚未实现，属未来规划」，不执行任何动作。反触发：集成收口（走 and-integrate）、开发后验证（走 and-verify）、环境看管（走 and-local-governance）。
---

按 and-release skill 执行任务。

先加载 and-release skill（用 skill 工具，ID 为 and-release），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

