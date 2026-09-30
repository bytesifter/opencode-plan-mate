# 盘点模块契约（worktree_inventory.py）

本文件是 `worktree_inventory.py` 的数据源与输出契约，供 AI 引用核对，不内嵌默认常量。

## 执行入口约束

- `--master-dir` 为治理执行入口 worktree 目录（当前会话 worktree，须 checkout 在 master）
- **全部 git 命令显式 `git -C <目录>` 锁定**，禁止依赖进程当前工作目录（spec「master worktree 执行入口」）

## 项目治理锚点

- 以项目（`--project` projectID）为锚点，一次盘点四类对象并关联（spec「项目治理锚点与范围」「项目全量盘点与对象关联」）

## 数据源端点与命令

| 数据 | 来源 | 调用 | 备注 |
|------|------|------|------|
| change 清单 | openspec CLI | `openspec list --json` | `[{name, status}]`，in-progress/complete 等 |
| 会话清单 | opencode API | `GET /api/session?project=<id>&limit=1000` | 含 `location.directory`、`time.updated`（毫秒）、`category`（master/attached/orphan） |
| worktree 清单（已保存） | opencode API | `GET /api/worktree?projectID=<id>` | 响应 `{value:[{directory,strategy}]}` 或数组 |
| 仓库 worktree | git | `git -C <master-dir> worktree list --porcelain` | 含 branch/detached/bare |
| 脏检测 | git | `git -C <dir> status --porcelain` | 非空 = dirty（有未提交/未跟踪改动） |
| 合并冲突检测 | git | `git -C <dir> rev-parse -q --verify MERGE_HEAD` | exit 0 = 冲突中 |
| feature 分支 | git | `git -C <master-dir> for-each-ref ... refs/heads/feature/*` | committerdate: unix + iso8601 |
| 已合并判定 | git | `git -C <master-dir> merge-base --is-ancestor <branch> master` | exit 0 = 已合并 |

## CLI 回退

- change CLI 失败 → 空清单 + `changes_source: "cli-failed:..."`（治理将对象视为孤儿处理）
- 会话 API 失败 → `opencode session list`（本地按 projectID 过滤），标记 `session_source: "cli"`
- worktree API 无 CLI 回退（git worktree list 已覆盖仓库侧）；git 命令无回退需求

## 路径归一化规则

- 所有目录输出统一为正斜杠 `/`；比较/输出前均归一
- `session_by_dir` / 关联映射用归一化后的目录做精确匹配

## 输出 JSON 结构

```
{
  projectID, master_dir, changes_source, session_source,
  changes: [{name, status}],
  sessions: [{id, title, projectID, time_updated, time_created, directory, category}],
  worktrees_api: [{directory, strategy}],
  git_worktrees: [{directory, head, branch?, detached?, bare?,
                   dirty, in_merge, is_master, merged_to_master}],
  feature_branches: [{name, committerdate_unix, committerdate_iso, merged_to_master}],
  correlations: {
    change_to_branch: [{change, status, branch|null}],
    branch_to_worktree: [{branch, directory}],
    worktree_to_session: [{directory, session_id}],
    orphans: { branches: [...], worktrees: [...], sessions: [...] }
  }
}
```

- `git_worktrees[].dirty`：是否有未提交/未跟踪改动；`in_merge`：合并冲突中；`is_master`：执行入口
- `sessions[].category`：会话归属类别——`master`（directory 等于 master worktree 目录）/ `attached`（属于其他 git worktree）/ `orphan`（directory 为空，或不属于任何 git worktree；即游离会话，供纯会话治理）
- `correlations`：change↔分支按命名（`feature/<change>`）、分支↔worktree 按 checkout、worktree↔会话按 location；孤儿区标记未关联对象——`orphans.sessions` 含 directory 为空或无 worktree 归属的会话（含空目录会话）

## 版本记录

- 2026-09-27：初版（三 skill 共用盘点）
- 2026-09-28：治理化改造（dirty/in_merge/is_master、`-C` 锁定）
- 2026-09-28：项目锚点改造（openspec changes 数据源、四对象关联、orphan 标记、merged_to_master 前置）
- 2026-09-29：纯会话治理（会话增加 `category` 标记；orphan 定义扩展至空 directory）
