---
description: 技术文章校验（多源独立评审）：默认依项目本地规范校验（运行时经项目根 AGENTS.md 抽取规则集），可选按配置注册的外部平台标准（CSDN 等网页）独立评审打分。每源独立报告、不混合分数。当用户要检查/校验/审查一篇技术文章（markdown）质量、发布前自检、或按指定平台标准做发布评审时使用。反触发：非 markdown 文档、纯代码文件、配置文件不校验。
---

按 and-validate-article skill 执行任务。

先加载 and-validate-article skill（用 skill 工具，ID 为 and-validate-article），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

