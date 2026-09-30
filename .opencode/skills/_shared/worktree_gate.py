#!/usr/bin/env python3
"""worktree_gate —— 项目治理共享门禁模块（单一权威，纯标准库）

对项目盘点 JSON 施加**执行入口门禁**，输出门禁结果（盘点完整透传，供 classify 做项目总览）：
  - G1 master 执行入口: 当前会话（--session）worktree 必须 checkout 在 master 分支
    （当前会话目录对应 git worktree 的 branch == master），否则拒绝治理并给出原因
  - G2 当前应用限定: 只处理盘点 projectID 内对象（盘点已按 projectID 过滤，此处复核）
  - G3 自保护（元数据）: 计算排除集——执行入口（master worktree）目录、**活跃会话** worktree
    （按 `--idle-days` 闲置阈值判定，闲置会话可回收不入保留区）、**change in-progress 的关联分支/worktree**；
    排除集供报告「保留区」与 SKILL 执行参考，盘点数据 SHALL 完整透传（保护对象由 classify 标 keep，
    保证项目总览完整）

与 spec「master worktree 执行入口」「change 状态门控处置」「自保护」一致：
  非 master 会话调用治理 SHALL 被拒绝；master worktree 自身、活跃会话 worktree、
  in-progress change 的关联资产 SHALL NOT 进入处置。

用法:
    python worktree_gate.py --inventory inventory.json --session <session-id> [--idle-days 15]
    python worktree_inventory.py --project <id> --master-dir <dir> --json \
        | python worktree_gate.py --stdin --session <id> [--idle-days 15]

输入:
    --inventory <file>  盘点 JSON 文件
    --stdin             从 stdin 读盘点 JSON
    --session <id>      调用会话 id（判定执行入口 + 自保护）
    --idle-days <int>   会话闲置阈值天数（默认 15，SKILL 从 agents-defaults.yaml 读取传入）
    --exclude <dir>     额外排除的 worktree 目录（可多次）

输出: JSON —— 原盘点（完整透传）+ 门禁结果 gate：
    gate: { allowed, reason, current_project, current_session, master_dir,
            excluded_dirs, excluded_branches }
    allowed=false 表示门禁未过（非 master 会话 / 非当前应用），调用方 SHALL 停下报告。
"""

import argparse
import json
import sys
import time


def normalize(p: str) -> str:
    """路径归一化：统一为正斜杠（与 inventory 口径一致，防御不同来源路径）。"""
    if not p:
        return p
    return p.replace("\\", "/").rstrip("/")


def session_active(session, idle_days):
    """会话是否活跃：time_updated 距今 < idle_days；缺失/异常时间戳视为过期。"""
    if not session:
        return False
    t = session.get("time_updated")
    if not t:
        return False
    try:
        t = int(t)
        if t > 10 ** 12:  # 毫秒转秒
            t //= 1000
    except (TypeError, ValueError):
        return False
    return t >= int(time.time()) - idle_days * 86400


def _wt_by_dir(git_worktrees):
    """git worktree 目录 -> 条目（已归一化匹配）。"""
    return {normalize(w.get("directory", "")): w for w in git_worktrees if w.get("directory")}


def apply_gate(inventory, session_id, extra_exclude_dirs, idle_days=15):
    """施加门禁：master 执行入口判定 + 当前应用复核 + 自保护/change 门控排除。"""
    project = inventory.get("projectID", "")
    sessions = inventory.get("sessions", [])
    wt_api = inventory.get("worktrees_api", [])
    git_wt = inventory.get("git_worktrees", [])
    correlations = inventory.get("correlations", {})
    master_dir = inventory.get("master_dir", "")
    wt_by_dir = _wt_by_dir(git_wt)

    # 定位调用会话及其 worktree 目录（归一化，防御不同来源路径）
    current_session = next((s for s in sessions if s.get("id") == session_id), None)
    session_dir = normalize((current_session or {}).get("directory", ""))

    # G1: master 执行入口判定
    allowed = True
    reason = ""
    if not session_dir:
        allowed = False
        reason = "无法定位当前会话 worktree 目录，治理需在 master worktree 的会话中执行"
    else:
        wt = wt_by_dir.get(session_dir) or {}
        branch = wt.get("branch", "")
        if branch != "master":
            allowed = False
            reason = f"治理需在 master worktree 的会话中执行（当前会话目录 {session_dir} checkout 于 {branch or '游离态'}）"

    # G2: 当前应用复核
    if allowed and inventory.get("projectID") != project:
        allowed = False
        reason = "盘点 projectID 与当前应用不一致，拒绝治理"

    # G3: 自保护 —— 执行入口目录 + 活跃会话目录 + in-progress change 关联分支/worktree
    exclude_dirs = {normalize(d) for d in (extra_exclude_dirs or [])}
    if session_dir:
        exclude_dirs.add(session_dir)
    if master_dir:
        exclude_dirs.add(normalize(master_dir))

    # 活跃会话 worktree：仅活跃会话目录进入排除集（闲置会话可回收，不入保留区；
    # 纯会话对象处置由 classify 判定，此处自保护仅护活跃会话与执行入口）
    for s in sessions:
        if s.get("id") != session_id and s.get("directory"):
            if session_active(s, idle_days):
                exclude_dirs.add(normalize(s["directory"]))

    # in-progress change 门控：排除其关联分支与 worktree
    excluded_branches = set()
    for c in correlations.get("change_to_branch", []):
        if c.get("status") == "in-progress" and c.get("branch"):
            excluded_branches.add(c["branch"])
    for b2w in correlations.get("branch_to_worktree", []):
        if b2w.get("branch") in excluded_branches:
            exclude_dirs.add(normalize(b2w.get("directory", "")))

    # 盘点完整透传（classify 需全量做项目总览，保护对象在其中标 keep）；
    # 排除集仅作元数据供报告「保留区」与 SKILL 执行参考。
    return {
        **inventory,
        "gate": {
            "allowed": allowed,
            "reason": reason,
            "current_project": project,
            "current_session": session_id,
            "current_session_directory": session_dir,
            "master_dir": master_dir,
            "excluded_dirs": sorted(exclude_dirs),
            "excluded_branches": sorted(excluded_branches),
        },
    }


def main():
    ap = argparse.ArgumentParser(description="项目治理共享门禁模块")
    ap.add_argument("--inventory", help="盘点 JSON 文件路径")
    ap.add_argument("--stdin", action="store_true", help="从 stdin 读盘点 JSON")
    ap.add_argument("--session", required=True, help="调用会话 id（判定入口 + 自保护）")
    ap.add_argument("--idle-days", type=int, default=15, help="会话闲置阈值天数（默认 15，SKILL 从 agents-defaults.yaml 读取传入）")
    ap.add_argument("--exclude", action="append", default=[], help="额外排除目录（可多次）")
    a = ap.parse_args()

    if a.inventory:
        with open(a.inventory, encoding="utf-8") as f:
            inventory = json.load(f)
    elif a.stdin:
        inventory = json.loads(sys.stdin.read().lstrip("\ufeff"))
    else:
        print("需要 --inventory <file> 或 --stdin", file=sys.stderr)
        return 2

    result = apply_gate(inventory, a.session, a.exclude, a.idle_days)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
