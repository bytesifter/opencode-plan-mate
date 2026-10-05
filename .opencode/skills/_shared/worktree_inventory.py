#!/usr/bin/env python3
"""worktree_inventory —— 项目治理共享盘点模块（单一权威，纯标准库）

以项目为治理锚点，盘点四类对象并建立关联，输出 JSON：
  - changes:        openspec `list --json` 的 change 清单（name/status）
  - sessions:       opencode `GET /api/session?project=` 的会话（含 location、time.updated、category: master/attached/orphan）
  - worktrees_api:  opencode `GET /api/worktree?projectID=` 的已保存 worktree
  - git_worktrees:  `git worktree list --porcelain` 的仓库 worktree
                    （含 branch/detached + dirty/in_merge/is_master/merged_to_master）
  - feature_branches:`git for-each-ref refs/heads/feature/*`（含 committerdate + merged_to_master）
  - correlations:   关联映射——change↔分支(按命名 feature/<change>)、分支↔worktree(checkout)、
                    worktree↔会话(location)，及孤儿区（无关联的分支/游离 worktree/无处落地会话）

治理执行入口约束（与 spec「master worktree 执行入口」一致）：
  - `--master-dir` 为执行入口 worktree 目录（当前会话 worktree，须 checkout 在 master）
  - 全部 git 命令显式 `git -C <目录>` 锁定，禁止依赖进程当前工作目录

用法:
    python worktree_inventory.py --project <projectID> --master-dir <dir> [--opencode <path>]
    python worktree_inventory.py --project <projectID> --master-dir <dir> --json > inventory.json

数据源:
    openspec CLI:  list --json（change 名称与状态）
    opencode API:  GET /api/session?project=、GET /api/worktree?projectID=
    git:           worktree list --porcelain、for-each-ref refs/heads/feature/*、
                   status --porcelain（脏检测）、rev-parse MERGE_HEAD（冲突检测）、
                   merge-base --is-ancestor（已合并判定）
    调用失败时 API 回退到等价 CLI（opencode session list），并标记 fallback。

路径归一化: 所有目录输出统一为正斜杠。输出 JSON 供 gate / classify 模块或 AI 直接消费。
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def run(cmd):
    """执行命令并返回 (exit_code, stdout, stderr)。跨平台，utf-8 容错。"""
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", "command not found: " + str(cmd)


def git(dirpath, *args):
    """git -C <dirpath> <args...>：全部 git 命令经此执行，显式锁定仓库目录。"""
    return run(["git", "-C", str(dirpath)] + list(args))


def normalize(p: str) -> str:
    """路径归一化：统一为正斜杠。"""
    if not p:
        return p
    return p.replace("\\", "/").rstrip("/")


def opencode_api(method, path, opencode_bin="opencode"):
    """调用 opencode api，返回 (ok, data)。失败回退 CLI 时由调用方标记。"""
    code, out, err = run([opencode_bin, "api", method, path])
    if code != 0:
        return False, {"error": out + err}
    try:
        return True, json.loads(out)
    except json.JSONDecodeError:
        return False, {"error": "invalid json: " + out[:200]}


def fetch_changes(openspec_bin="openspec"):
    """openspec change 清单：`openspec list --json` -> [{name, status}]。"""
    code, out, err = run([openspec_bin, "list", "--json"])
    if code != 0:
        return [], "cli-failed:" + (out + err)[:200]
    try:
        data = json.loads(out)
        if isinstance(data, dict):
            data = data.get("changes", [])
        result = []
        for c in data if isinstance(data, list) else []:
            result.append({"name": c.get("name", ""), "status": c.get("status", "")})
        return result, "cli"
    except json.JSONDecodeError:
        return [], "cli-failed:invalid-json"


def fetch_sessions(project, opencode_bin="opencode"):
    """会话清单：优先 API，失败回退 CLI 并标记。"""
    ok, data = opencode_api("GET", f"/api/session?project={project}&limit=1000", opencode_bin)
    if ok:
        items = data.get("data", data if isinstance(data, list) else [])
        return items, "api"
    code, out, err = run([opencode_bin, "session", "list", "--max-count", "1000", "--format", "json"])
    if code != 0:
        return [], "cli-failed:" + (out + err)[:200]
    try:
        items = json.loads(out)
        if isinstance(items, dict):
            items = items.get("data", [])
        return items, "cli"
    except json.JSONDecodeError:
        return [], "cli-failed:invalid-json"


def fetch_worktrees_api(project, opencode_bin="opencode"):
    """opencode 已保存 worktree 清单（含 strategy）。"""
    ok, data = opencode_api("GET", f"/api/worktree?projectID={project}", opencode_bin)
    if not ok:
        return []
    if isinstance(data, dict):
        return data.get("value", data.get("data", []))
    return data if isinstance(data, list) else []


def fetch_git_worktrees(master_dir):
    """git worktree list --porcelain：仓库全部 worktree 及分支归属，经 -C 锁定。"""
    code, out, _ = git(master_dir, "worktree", "list", "--porcelain")
    if code != 0:
        return []
    result = []
    cur = {}
    for line in out.splitlines():
        line = line.strip()
        if not line:
            if cur:
                result.append(cur)
                cur = {}
            continue
        if line.startswith("worktree "):
            cur["directory"] = normalize(line[len("worktree "):].strip())
        elif line.startswith("HEAD "):
            cur["head"] = line[len("HEAD "):].strip()
        elif line.startswith("branch "):
            cur["branch"] = line[len("branch "):].strip().replace("refs/heads/", "")
        elif line == "detached":
            cur["detached"] = True
        elif line.startswith("bare"):
            cur["bare"] = True
    if cur:
        result.append(cur)
    return result


def probe_worktree_state(directory):
    """单 worktree 状态探测：脏 / 合并冲突中。均经 git -C <dir> 显式锁定。"""
    state = {"dirty": False, "in_merge": False}
    if not directory:
        return state
    code, out, _ = git(directory, "status", "--porcelain")
    if code == 0 and out.strip():
        state["dirty"] = True
    code, _, _ = git(directory, "rev-parse", "-q", "--verify", "MERGE_HEAD")
    if code == 0:
        state["in_merge"] = True
    return state


def fetch_feature_branches(master_dir):
    """feature 分支清单：refs/heads/feature/* 的 committerdate（unix + iso）。"""
    code, out, _ = git(
        master_dir,
        "for-each-ref",
        "--format=%(refname:short)|%(committerdate:unix)|%(committerdate:iso8601)",
        "refs/heads/feature/*",
    )
    if code != 0:
        return []
    result = []
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) == 3:
            result.append({
                "name": parts[0],
                "committerdate_unix": parts[1],
                "committerdate_iso": parts[2],
            })
    return result


def merged_into_master(branch, master_dir):
    """分支是否已合并 master：git -C <master-dir> merge-base --is-ancestor。"""
    if not branch or not master_dir:
        return False
    code, _, _ = git(master_dir, "merge-base", "--is-ancestor", branch, "master")
    return code == 0


def branch_touched_changes(branch, master_dir):
    """分支相对 master 的 diff 命中的 `openspec/changes/<name>/` 集合（排除 `archive/`）。

    用于关联补充：命名匹配（`feature/<change>`）之外的「搭车」/ 多 change 分支。
    基线用三点 diff（merge-base..branch），只算分支自带的改动。
    """
    if not branch or not master_dir:
        return set()
    code, out, _ = git(master_dir, "diff", "--name-only", f"master...{branch}", "--", "openspec/changes")
    if code != 0:
        return set()
    names = set()
    for line in out.splitlines():
        m = re.match(r"openspec/changes/([^/]+)/", line.strip().replace("\\", "/"))
        if m:
            seg = m.group(1)
            if seg and seg != "archive":
                names.add(seg)
    return names


def build_inventory(project, master_dir, opencode_bin="opencode"):
    """组装项目盘点 JSON（四对象 + 关联）。master_dir 为执行入口（当前会话，须 master 分支）。"""
    changes, changes_source = fetch_changes()
    sessions, session_source = fetch_sessions(project, opencode_bin)
    worktrees_api = fetch_worktrees_api(project, opencode_bin)
    git_worktrees = fetch_git_worktrees(master_dir)
    feature_branches = fetch_feature_branches(master_dir)

    master_dir_n = normalize(master_dir)
    change_by_name = {c["name"]: c for c in changes}

    # worktree 目录集合（会话归属判定：master / attached / orphan）
    wt_dirs = {normalize(w.get("directory", "")) for w in git_worktrees if w.get("directory")}

    # 会话归一化（category: master=master worktree 目录 / attached=其他 worktree / orphan=无有效归属含空目录）
    normalized_sessions = []
    for s in sessions:
        loc = s.get("location") or {}
        t = s.get("time") or {}
        directory = normalize(loc.get("directory", ""))
        if directory and directory == master_dir_n:
            category = "master"
        elif directory and directory in wt_dirs:
            category = "attached"
        else:
            category = "orphan"
        normalized_sessions.append({
            "id": s.get("id", ""),
            "title": s.get("title", ""),
            "projectID": s.get("projectID", project),
            "time_updated": t.get("updated"),
            "time_created": t.get("created"),
            "directory": directory,
            "category": category,
        })

    # worktree API 归一化
    normalized_wt_api = [
        {"directory": normalize(w.get("directory", "")), "strategy": w.get("strategy", "")}
        for w in worktrees_api
    ]

    # feature 分支增强：merged_to_master
    enriched_branches = []
    for b in feature_branches:
        enriched_branches.append({**b, "merged_to_master": merged_into_master(b["name"], master_dir)})

    # 分支 diff 命中的 changes（关联补充：命名匹配之外的多 change / 搭车）
    branch_touched = {
        b["name"]: branch_touched_changes(b["name"], master_dir)
        for b in enriched_branches
    }

    # git worktree 增强：脏 / 冲突 / 执行入口(master) / 已合并
    enriched_git_wt = []
    for w in git_worktrees:
        d = w.get("directory", "")
        state = probe_worktree_state(d)
        branch = w.get("branch", "")
        enriched_git_wt.append({
            **w,
            **state,
            "is_master": d == master_dir_n,
            "merged_to_master": merged_into_master(branch, master_dir) if branch else None,
        })

    # ---- 关联 ----
    session_by_dir = {s["directory"]: s for s in normalized_sessions if s["directory"]}
    all_branch_names = {b["name"] for b in enriched_branches}
    branch_checked_out = {w.get("branch"): w.get("directory") for w in enriched_git_wt if w.get("branch")}

    # change -> branch（命名匹配 feature/<change> 优先；否则回退 diff 命中的分支）
    change_to_branch = []
    for c in changes:
        cand = "feature/" + c["name"]
        if cand in all_branch_names:
            branch = cand
        else:
            branch = next(
                (bname for bname, touched in branch_touched.items() if c["name"] in touched),
                None,
            )
        change_to_branch.append({"change": c["name"], "status": c["status"], "branch": branch})

    # branch -> worktree（checkout 关系）
    branch_to_worktree = [
        {"branch": w["branch"], "directory": w["directory"]}
        for w in enriched_git_wt if w.get("branch")
    ]

    # worktree -> session（location 指向）
    worktree_to_session = [
        {"directory": d, "session_id": s["id"]}
        for d, s in session_by_dir.items()
        if any(w["directory"] == d for w in enriched_git_wt)
    ]

    # 孤儿区：无 change 关联的分支 / 游离 worktree（无分支）/ 无处落地会话
    matched_branches = {c["branch"] for c in change_to_branch if c["branch"]}
    orphan_branches = [
        b["name"] for b in enriched_branches
        if b["name"] not in matched_branches
    ]
    orphan_worktrees = [
        w["directory"] for w in enriched_git_wt
        if not w.get("branch") and not w.get("is_master")
    ]
    wt_dirs = {w["directory"] for w in enriched_git_wt}
    orphan_sessions = [
        s["id"] for s in normalized_sessions
        if s.get("category") == "orphan"
    ]

    correlations = {
        "change_to_branch": change_to_branch,
        "branch_to_worktree": branch_to_worktree,
        "worktree_to_session": worktree_to_session,
        "orphans": {
            "branches": orphan_branches,
            "worktrees": orphan_worktrees,
            "sessions": orphan_sessions,
        },
    }

    return {
        "projectID": project,
        "master_dir": master_dir_n,
        "changes": changes,
        "changes_source": changes_source,
        "sessions": normalized_sessions,
        "session_source": session_source,
        "worktrees_api": normalized_wt_api,
        "git_worktrees": enriched_git_wt,
        "feature_branches": enriched_branches,
        "correlations": correlations,
    }


def main():
    ap = argparse.ArgumentParser(description="项目治理共享盘点模块")
    ap.add_argument("--project", required=True, help="当前应用 projectID")
    ap.add_argument("--master-dir", required=True, help="执行入口 worktree 目录（当前会话，须 master 分支）")
    ap.add_argument("--opencode", default="opencode", help="opencode 可执行文件路径")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    a = ap.parse_args()

    inv = build_inventory(a.project, a.master_dir, a.opencode)
    if a.json:
        print(json.dumps(inv, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(inv, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
