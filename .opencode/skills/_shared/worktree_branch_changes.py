#!/usr/bin/env python3
"""worktree_branch_changes —— 分支携带的 changes 判定（共享权威，纯标准库）

输出某个 worktree/分支**携带哪些 openspec change**：
  - **命名匹配**：分支名 `feature/<change>` -> `<change>`
  - **diff 派生**：分支相对 `--base` 的 diff 命中的 `openspec/changes/<name>/`（排除 `archive/`）
合并去重后，附各 change 当前状态（`openspec list --json`）。

供 `and-verify` 前置门禁消费（判定「分支携带的 changes 是否全部 complete」），
与 `worktree_inventory.py` 的关联口径一致（命名匹配 ∪ diff 派生）。

用法:
    python worktree_branch_changes.py --dir <worktree> [--base master] [--openspec openspec]
输出: JSON —— [{change, status}]
"""

import argparse
import json
import re
import subprocess
import sys


def git(dirpath, *args):
    """git -C <dirpath> <args...>：显式锁定仓库目录。"""
    try:
        p = subprocess.run(
            ["git", "-C", str(dirpath)] + list(args),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", "command not found"


def branch_name(dirpath):
    """当前 worktree 的 checkout 分支名（游离态返回空）。"""
    code, out, _ = git(dirpath, "branch", "--show-current")
    return out.strip() if code == 0 else ""


def named_change(branch):
    """命名匹配：`feature/<change>` -> `<change>`；非 feature 分支返回 None。"""
    if branch.startswith("feature/"):
        return branch[len("feature/"):] or None
    return None


def diff_changes(dirpath, base):
    """分支相对 `--base` 的 diff 命中 `openspec/changes/<name>/` 的集合（排除 `archive/`）。"""
    code, out, _ = git(dirpath, "diff", "--name-only", f"{base}...HEAD")
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


def change_statuses(dirpath, openspec_bin="openspec"):
    """worktree 内 `openspec list --json` 的 name -> status（失败返回空）。"""
    try:
        p = subprocess.run(
            [openspec_bin, "list", "--json"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            cwd=str(dirpath),
        )
        data = json.loads(p.stdout)
    except Exception:
        return {}
    if isinstance(data, dict):
        data = data.get("changes", [])
    return {c.get("name", ""): c.get("status", "") for c in data if c.get("name")}


def collect(dirpath, base="master", openspec_bin="openspec"):
    """分支携带的 changes：命名匹配 ∪ diff 派生，附状态，按名排序。"""
    names = set()
    n = named_change(branch_name(dirpath))
    if n:
        names.add(n)
    names |= diff_changes(dirpath, base)
    statuses = change_statuses(dirpath, openspec_bin)
    return [{"change": x, "status": statuses.get(x, "unknown")} for x in sorted(names)]


def main():
    ap = argparse.ArgumentParser(description="分支携带的 changes 判定")
    ap.add_argument("--dir", required=True, help="worktree 目录")
    ap.add_argument("--base", default="master", help="diff 基线分支（默认 master）")
    ap.add_argument("--openspec", default="openspec", help="openspec 可执行文件")
    a = ap.parse_args()
    print(json.dumps(collect(a.dir, a.base, a.openspec), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
