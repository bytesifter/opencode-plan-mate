# 门禁模块契约（worktree_gate.py）

本文件是 `worktree_gate.py` 的门禁规则契约，供 AI 引用核对。

## 门禁规则

| 门禁 | 规则 | 依据 |
|------|------|------|
| G1 master 执行入口 | 调用会话（`--session`）worktree 必须 checkout 在 master 分支；否则 `allowed=false` 并给出原因 | spec「master worktree 执行入口」 |
| G2 当前应用限定 | 只处理盘点 projectID 内对象（盘点已按 projectID 过滤，此处复核） | spec「项目治理锚点与范围」 |
| G3 自保护（元数据） | 计算排除集：执行入口目录 + **活跃会话** worktree（按 `--idle-days` 闲置阈值判定，闲置会话可回收不入保留区）+ in-progress change 关联分支/worktree；**盘点完整透传**，排除集仅供报告与执行参考 | spec「change 状态门控处置」「自保护」「纯会话治理范畴」 |

## 判定与排除逻辑

- 定位调用会话：`inventory.sessions[].id == --session`，取其 `directory`
- G1 判定：该目录对应 git worktree 的 `branch == master`；游离态或非 master 分支 → `allowed=false`
- G3 排除集：
  - 执行入口目录（`master_dir`）+ `--exclude` 追加目录
  - 活跃会话 worktree：`inventory.sessions` 中其他会话指向的目录，**且会话活跃**（`time_updated` 距今 < `--idle-days`，缺失/异常时间戳视为过期）；闲置会话可回收，不入排除集
  - in-progress change：`correlations.change_to_branch` 中 status=in-progress 的分支及其 worktree（经 `branch_to_worktree`）
- `--idle-days`：会话闲置阈值天数（默认见项目 `agents-defaults.yaml` 的 `session_idle_days`；本模块不内嵌常量）
- **盘点数据完整透传**（`**inventory`）：classify 需全量对象做项目总览，保护对象由 classify 标 keep，不从盘点中剥离

## 输出 JSON 结构

```
{
  ...inventory 完整透传（changes/sessions/worktrees/git_worktrees/feature_branches/correlations）,
  gate: {
    allowed: bool,
    reason: string,              # allowed=false 时给出拒绝原因
    current_project, current_session, current_session_directory,
    master_dir,
    excluded_dirs: [...],
    excluded_branches: [...]
  }
}
```

- `allowed=false` 表示门禁未过（非 master 会话 / 应用不符），调用方 SHALL 停下报告，不执行治理
- 执行顺序建议：inventory → gate（入口检查）→ classify（全量对象状态机处置 + 项目总览）

## 版本记录

- 2026-09-27：初版
- 2026-09-28：治理化改造（G1 allowed/reason、G3 执行入口排除）
- 2026-09-28：项目锚点改造（G3 扩展 in-progress change 门控、盘点完整透传、排除集作元数据）
- 2026-09-29：纯会话治理（G3 排除集改为仅活跃会话目录，按 `--idle-days` 判定）
