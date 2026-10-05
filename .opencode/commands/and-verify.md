---
description: feature 侧开发后验证（执行入口=当前会话 worktree，单 skill，AI 自主执行）：在有代码修改的当前会话 worktree（feature 分支或游离态，非 master）内，校验分支携带的 change 全部完成后，完成验证闭环——固化（游离态先落 feature/<change> 分支，再提交本次代码修改）→ 同步主干（merge master）→ 冲突解决（业务逻辑判定，尽可能 AI-native：无冲突自动解决、有冲突停下交人工）→ 部署目标环境（三态：无运行时产物记「未执行」，不阻断）→ 分层测试（unit 本地 / 系统内+e2e 环境）→ 生成测试报告（dev-notes/test-reports/<feature>/，供 and-integrate 合并门禁消费）→ 推送 feature 分支。执行入口为当前会话 worktree（非 master；master 会话拒绝），操作对象为当前 worktree。当开发者完成一轮开发、需要验证并推送可合并分支时使用。反触发：master 侧合并/归档（走 and-integrate）、环境看管与其他/无会话游离态固化（走 and-local-governance）、普通 git 操作。
---

按 and-verify skill 执行任务。

先加载 and-verify skill（用 skill 工具，ID 为 and-verify），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

