---
description: 项目级本地环境看管 + 游离态固化（执行入口=master worktree，单 skill，AI 自主执行，双信号模型）：以项目（projectID）为锚点盘点关联 change / worktree / 功能分支 / 会话（含 time_updated），先落报告总览（看清：做到哪/做完没/合并没/会话闲没闲）再快速处理——游离态固化（其他/无会话的 detached worktree 有工作即落 feature 分支保工作；当前会话游离态归 and-verify）→ 代码终端态清理（已合并+干净，git 状态足够不等会话）→ 会话闲置回收（闲置超 `session_idle_days` 删会话，含 master 非当前会话与游离会话的纯会话回收）。feature 态固化与当前会话游离态固化归 and-verify、feature→master 合并与 master 收口提交（M 链）与变更归档归 and-integrate，本 skill 只做环境看管（含派生 ns 回收）与其他/无会话游离态固化：feature 态脏对象保留报告不碰，少用阻断（记账号续），治理报告落盘；标准随 skill 内部权威文件（references/governance-standards.md）。当用户要求治理/看清项目 worktree 状态、游离态收尾固化、回收本地残留与过期会话时使用。反触发：feature 侧验证与固化、当前会话游离态固化（走 and-verify）、feature→master 合并 / 归档（走 and-integrate）、worktree 创建（opencode 内置）、普通 git 操作。
---

按 and-local-governance skill 执行任务。

先加载 and-local-governance skill（用 skill 工具，ID 为 and-local-governance），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

