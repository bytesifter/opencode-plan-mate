---
description: and-design-system-audit 程序项目设计文档体系合理性校验：规范驱动、手动触发、AI 语义判定、只读不自动修。Step 0 读项目根 AGENTS.md 指针定位规范体系并判定项目类型；Step 1 从规范文本自动抽取文档模型（doc_types + 每类位置/结构/内容，每条必引规范依据），冲突/空缺即中断只报事实；Step 2-4 按抽取模型做位置/结构/内容三关校验，skill 不写死任何文档类型或路径；Step 5 双口径报告。当用户要检查/审计/校验程序项目设计文档体系（愿景/架构/技术方案等文档及其位置/结构/内容是否合理、是否符合规范）时使用。反触发：审计 openspec change 是否满足上游设计（走 and-openspec-upstream-audit）、校验技术文章（走 and-validate-article）、存量 change 回填。
---

按 and-design-system-audit skill 执行任务。

先加载 and-design-system-audit skill（用 skill 工具，ID 为 and-design-system-audit），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

