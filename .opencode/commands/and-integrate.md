---
description: master 侧集成收口（执行入口=master worktree，唯一写主干的 skill）：对开发完成、已推送的 feature 分支执行收口闭环——① 合并门禁判定（消费 and-verify 产出的 dev-notes/test-reports/<feature>/ 与 test-plans，档位分治 + G3 测试完整性「计划承诺→报告兑现」）② feature→master 合并（--no-ff）③ 变更归档（openspec archive）④ master 收口提交与发布（仅本次运行产物；领先则发布）⑤ master 集成验证（部署 master + 完整测试 unit/系统内/e2e → 报告，非门禁）。执行入口为 master worktree（非 master 会话拒绝），操作对象为 feature 分支 / master / change。执行入口与操作对象分离；合并冲突停下交人工、门禁未过不合并、归档报错记异常继续。当需要把已验证分支并入主干并归档 change 时使用。反触发：feature 侧开发后验证（走 and-verify）、环境看管与游离态固化 + 会话回收（走 and-local-governance）、普通 git 操作。
---

按 and-integrate skill 执行任务。

先加载 and-integrate skill（用 skill 工具，ID 为 and-integrate），严格按该 skill 定义的工作流执行；只处理当前 worktree / 当前项目，不跨项目操作。若 skill 缺位，说明原因并停止，不臆断执行。

