#!/usr/bin/env python3
"""worktree_classify —— 项目治理共享处置判定引擎（单一权威，纯标准库）

接收项目盘点 JSON（含四对象、关联、会话 time_updated），按**双信号模型**输出处置：
  - 代码对象（分支/worktree）由 git 状态驱动：已合并 master + 干净 = 代码终端态
  - 会话对象由会话闲置时间驱动：time_updated 距今 > session_idle_days = 会话过期
    （会话对话内容对 git 不可见，闲置时间是其"无新内容"的代理信号）

处置值：
  - solidify: 有可固化内容（未提交工作 / 游离未入主干提交）-> 无条件固化
              （提交 -> 游离态落分支 -> 合并 master→feature 同步 -> 推送）
  - cleanup:  代码终端态（已合并+干净+change 非 in-progress 或孤儿已合并）-> 删 worktree+分支；
              游离纯残留（干净+HEAD 已入 master）-> 删沙箱+会话
  - recycle:  未合并分支 + 会话过期/无会话 -> 回收沙箱+会话，保留分支（待合并/进行中）
  - keep:     执行入口自保护 / in-progress 分支 / 未合并干净+会话活跃 / 非 feature 分支
  - stuck:    合并冲突未解决（dirty + in_merge）
  - pending_merge: 未合并干净分支的标注（待合并门禁判定，门禁通过后治理自动执行 feature→master 合并）

判定依据与 spec「双信号驱动模型」「change 状态门控处置」「固化逻辑（无条件）」
「代码对象终端态清理」「会话闲置回收」「未合并对象处置」「合并边界」及治理规范一致。

git 命令全部显式 `git -C <目录>` 锁定；已合并判定用 master_dir，游离 HEAD 祖先判定用 worktree 目录。
`session_idle_days` 由 `--idle-days` 传入（SKILL 从 ./norms/agents-defaults.yaml §worktree_governance 读取），
本模块不内嵌常量（默认 15 仅作参数缺失兜底）。

用法:
    python worktree_classify.py --inventory inventory.json [--idle-days 15]
    python worktree_inventory.py --project <id> --master-dir <dir> --json \
        | python worktree_classify.py --stdin [--idle-days 15]

输出: JSON（stdout）。objects 为项目总览 + 处置清单，供 skill 执行并写入治理报告。
"""

import argparse
import json
import subprocess
import sys
import time


def normalize(p: str) -> str:
    """路径归一化：统一为正斜杠（与 inventory/gate 口径一致）。"""
    if not p:
        return p
    return p.replace("\\", "/").rstrip("/")


def git(dirpath, *args):
    """git -C <dirpath> <args...>：显式锁定仓库目录。"""
    try:
        p = subprocess.run(
            ["git", "-C", str(dirpath)] + list(args),
            capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", "command not found"


def merged_into_master(branch, master_dir):
    """feature 分支是否已合并 master：git -C <master-dir> merge-base --is-ancestor。"""
    if not branch or not master_dir:
        return False
    code, _, _ = git(master_dir, "merge-base", "--is-ancestor", branch, "master")
    return code == 0


def head_ancestor_of_master(worktree_dir, master_dir):
    """游离态 HEAD 是否为 master 祖先（无待保留的独立提交 = 纯残留）。"""
    if not worktree_dir or not master_dir:
        return False
    code, _, _ = git(worktree_dir, "merge-base", "--is-ancestor", "HEAD", "master")
    return code == 0


def session_active(session, now_sec, idle_days):
    """会话是否活跃：time_updated 距今 < session_idle_days。缺失/异常时间戳视为过期。"""
    if not session:
        return False
    t = session.get("time_updated")
    if not t:
        return False
    try:
        t = int(t)
        if t > 10**12:  # 毫秒转秒
            t //= 1000
    except (TypeError, ValueError):
        return False
    return t >= now_sec - idle_days * 86400


def decide(inventory, idle_days=15):
    """对项目盘点做双信号模型处置判定，返回 objects（项目总览 + 处置清单）。"""
    sessions = inventory.get("sessions", [])
    git_wt = inventory.get("git_worktrees", [])
    feature_branches = inventory.get("feature_branches", [])
    correlations = inventory.get("correlations", {})
    changes = inventory.get("changes", [])
    master_dir = inventory.get("master_dir", "")
    now_sec = int(time.time())

    # 项目级 change 状态门控（master 工作区提交锚点）：
    # 存在任一 in-progress change = 迭代在飞，master 不收口；
    # 存在 complete/archived change = 可关联终结锚点，master 提交有业务上下文
    has_in_progress_change = any(c.get("status") == "in-progress" for c in changes)
    master_commit_anchor = next(
        (c for c in changes if c.get("status") in ("complete", "archived")), None
    )

    session_by_dir = {}
    for s in sessions:
        d = s.get("directory", "")
        if d and d not in session_by_dir:
            session_by_dir[d] = s

    change_by_branch = {}
    for c in correlations.get("change_to_branch", []):
        if c.get("branch"):
            change_by_branch[c["branch"]] = (c["change"], c.get("status", ""))

    checked_out = {w.get("branch") for w in git_wt if w.get("branch")}
    branch_meta = {b["name"]: b for b in feature_branches}

    objects = []

    def make_obj(d, branch, detached, dirty, in_merge, is_master, active_session, sess):
        change, change_status = change_by_branch.get(branch, (None, None))
        obj = {
            "object_type": "worktree" if d else "branch",
            "directory": d,
            "branch": branch,
            "detached": bool(detached),
            "dirty": bool(dirty),
            "in_merge": bool(in_merge),
            "is_master": bool(is_master),
            "active_session": bool(active_session),
            "session_id": (sess or {}).get("id", ""),
            "change": change,
            "change_status": change_status,
            "orphan": change is None,
            "merged_to_master": None,
            "disposal": "keep",
            "reason": "",
            "pending_merge": False,
            "reasons": [],
            "master_commit": False,
        }
        return obj

    # ---- 1) worktree 对象 ----
    for w in git_wt:
        d = w.get("directory", "")
        branch = w.get("branch", "")
        detached = w.get("detached", False)
        dirty = w.get("dirty", False)
        in_merge = w.get("in_merge", False)
        is_master = w.get("is_master", False)
        # master worktree 对象不吸收会话（master 会话独立成纯会话对象，见会话循环）
        sess = session_by_dir.get(d) if not is_master else None
        active = session_active(sess, now_sec, idle_days)

        obj = make_obj(d, branch, detached, dirty, in_merge, is_master, active, sess)

        # 执行入口自保护 + master 工作区提交（双信号扩展）
        if is_master:
            if dirty:
                if has_in_progress_change:
                    obj["reason"] = "master 工作区脏，项目有 in-progress change，迭代在飞，master 不收口"
                elif master_commit_anchor is not None:
                    obj["disposal"] = "solidify"
                    obj["master_commit"] = True
                    obj["reason"] = f"master 工作区脏，无 in-progress change，基于 change「{master_commit_anchor.get('name', '')}」终结收口提交"
                else:
                    obj["reason"] = "master 工作区脏，无 change 锚点，不臆断提交 master"
            else:
                obj["reason"] = "master worktree 执行入口，自保护"
            objects.append(obj)
            continue
        # 合并冲突未解决
        if in_merge and dirty:
            obj["disposal"] = "stuck"
            obj["reason"] = "合并冲突未解决，既有未固化工作又无法清理，需人工介入"
            objects.append(obj)
            continue
        # 固化层（无条件）：有未提交工作，或游离有未入主干提交
        has_solidifiable = dirty or (detached and not head_ancestor_of_master(d, master_dir))
        if has_solidifiable:
            obj["disposal"] = "solidify"
            obj["reason"] = "游离态有工作待固化" if detached else "feature 分支有未提交工作（先固化保工作）"
            objects.append(obj)
            continue
        # 代码终端态层（git 状态驱动, 不等会话）：
        #   游离纯残留（干净+HEAD已入 master）或 已合并+干净+change 非 in-progress（或孤儿已合并）
        if detached:
            # 干净且 HEAD 已入 master = 纯残留；活跃会话保留沙箱，过期/无会话清理
            obj["merged_to_master"] = True
            if active:
                obj["reason"] = "游离态纯残留，会话活跃，保留沙箱"
            else:
                obj["disposal"] = "cleanup"
                obj["reason"] = "游离态纯残留（干净且无可保留提交）"
            objects.append(obj)
            continue
        if branch:
            merged = merged_into_master(branch, master_dir)
            obj["merged_to_master"] = merged
            if merged and change_by_branch.get(branch, (None, ""))[1] != "in-progress":
                obj["disposal"] = "cleanup"
                obj["reason"] = "代码终端态：已合并 master 且工作区干净"
                objects.append(obj)
                continue
            # change in-progress 门控（分支保留）
            if change_by_branch.get(branch, (None, ""))[1] == "in-progress":
                obj["reason"] = f"change {change_by_branch[branch][0]} in-progress，迭代在飞，保留分支"
                objects.append(obj)
                continue
            # 非 feature 分支
            if branch not in branch_meta:
                obj["reason"] = "非 feature 分支，保留"
                objects.append(obj)
                continue
            # 未合并干净分支：会话活跃 -> keep；会话过期/无会话 -> recycle
            if active:
                obj["reason"] = "未合并 master，会话活跃，保留沙箱"
                obj["pending_merge"] = True
            else:
                obj["disposal"] = "recycle"
                obj["reason"] = "未合并 master，会话过期/无会话，回收沙箱会话（保留分支待合并）"
                obj["pending_merge"] = True
            objects.append(obj)
            continue

        obj["reason"] = "无分支归属，保留"
        objects.append(obj)

    # ---- 2) 无沙箱 feature 分支 ----
    for b in feature_branches:
        if b["name"] in checked_out:
            continue
        change, change_status = change_by_branch.get(b["name"], (None, None))
        obj = make_obj("", b["name"], False, False, False, False, False, None)
        if change_status == "in-progress":
            obj["reason"] = f"change {change} in-progress，迭代在飞，保留分支"
            objects.append(obj)
            continue
        merged = merged_into_master(b["name"], master_dir)
        obj["merged_to_master"] = merged
        if merged:
            obj["disposal"] = "cleanup"
            obj["reason"] = "代码终端态：已合并 master（无沙箱，仅删分支）"
        else:
            obj["reason"] = "未合并 master，待合并门禁判定"
            obj["pending_merge"] = True
        objects.append(obj)

    # ---- 3) 纯会话对象（master 非当前会话 + 游离会话）----
    current_session_id = inventory.get("gate", {}).get("current_session", "")
    all_wt_dirs = set()
    non_master_wt_dirs = set()
    for w in git_wt:
        wd = normalize(w.get("directory", ""))
        if not wd:
            continue
        all_wt_dirs.add(wd)
        if not w.get("is_master"):
            non_master_wt_dirs.add(wd)
    master_dir_n = normalize(master_dir)

    for s in sessions:
        sid = s.get("id", "")
        sd = normalize(s.get("directory", ""))
        category = s.get("category", "")

        # 当前会话：无条件保留（会话 id 级保护，执行入口自保护）
        if sid and sid == current_session_id:
            objects.append({
                "object_type": "session",
                "directory": sd,
                "branch": "",
                "detached": False,
                "dirty": False,
                "in_merge": False,
                "is_master": False,
                "active_session": bool(session_active(s, now_sec, idle_days)),
                "session_id": sid,
                "change": None,
                "change_status": None,
                "orphan": False,
                "merged_to_master": None,
                "disposal": "keep",
                "reason": "执行入口会话，保留（会话 id 级保护）",
                "pending_merge": False,
                "reasons": [],
            })
            continue

        # 非 master worktree 会话：已由 worktree 对象处置，不重复成行
        if sd and sd in non_master_wt_dirs:
            continue

        # 归类：master 目录非当前会话 / 游离会话（空目录或无 worktree 归属）
        if category == "master" or sd == master_dir_n:
            label = "master 会话"
        elif category == "orphan" or not sd or sd not in all_wt_dirs:
            label = "游离会话"
        else:
            # 其他 worktree 会话（防御，正常由 worktree 对象处置）
            continue

        active = session_active(s, now_sec, idle_days)
        obj = {
            "object_type": "session",
            "directory": sd,
            "branch": "",
            "detached": False,
            "dirty": False,
            "in_merge": False,
            "is_master": False,
            "active_session": bool(active),
            "session_id": sid,
            "change": None,
            "change_status": None,
            "orphan": label == "游离会话",
            "merged_to_master": None,
            "disposal": "keep",
            "reason": "",
            "pending_merge": False,
            "reasons": [],
        }
        if active:
            obj["reason"] = f"{label}，会话活跃，保留"
        else:
            obj["disposal"] = "recycle"
            obj["reason"] = f"{label}，闲置超阈值，纯会话回收（仅删除会话，豁免先固化后回收）"
        objects.append(obj)

    # ---- 4) change 归档判定（archive_ready，供 skill Step 5a 归档执行）----
    archive_list = []
    change_to_branch_map = {c.get("change"): c for c in correlations.get("change_to_branch", [])}
    for c in changes:
        if c.get("status") != "complete":
            continue  # in-progress 等非 complete 不标（迭代在飞 / 未终结）
        name = c.get("name", "")
        c2b = change_to_branch_map.get(name, {})
        branch = c2b.get("branch") or None
        merged = None
        if branch:
            # 优先复用 inventory 已探测的 merged_to_master；缺失时回退 git 实时判定
            merged = branch_meta.get(branch, {}).get("merged_to_master")
            if merged is None:
                merged = merged_into_master(branch, master_dir)
        entry = {
            "change": name,
            "status": c.get("status"),
            "branch": branch,
            "merged_to_master": merged,
            "archive_ready": True,
            "pending_merge": False,
            "reasons": [],
            "reason": "",
        }
        if branch and merged is False:
            entry["archive_ready"] = False
            entry["pending_merge"] = True
            entry["reason"] = "complete 但分支未合并 master，走合并门禁判定，归档等待分支合入"
        elif branch:
            entry["reason"] = "complete 且分支已合并 master，可归档"
        else:
            entry["reason"] = "complete 且无关联分支，可归档"
        archive_list.append(entry)

    return {"objects": objects, "archives": archive_list}


def main():
    ap = argparse.ArgumentParser(description="项目治理共享处置判定引擎")
    ap.add_argument("--inventory", help="项目盘点 JSON 文件路径")
    ap.add_argument("--stdin", action="store_true", help="从 stdin 读盘点 JSON")
    ap.add_argument("--idle-days", type=int, default=15,
                    help="会话闲置阈值天数（默认 15，SKILL 从 agents-defaults.yaml 读取传入）")
    a = ap.parse_args()

    if a.inventory:
        with open(a.inventory, encoding="utf-8-sig") as f:
            inventory = json.load(f)
    elif a.stdin:
        inventory = json.loads(sys.stdin.read().lstrip("\ufeff"))
    else:
        print("需要 --inventory <file> 或 --stdin", file=sys.stderr)
        return 2

    result = decide(inventory, a.idle_days)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
