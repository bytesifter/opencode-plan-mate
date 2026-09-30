#!/usr/bin/env python3
"""worktree_ops_gate —— 生成/实施 change 的 worktree 门禁（单一权威，纯标准库）

对「生成与实施 change 类操作」施加 worktree 分治门禁：master 分支上禁止
`openspec new change` / `openspec propose` / `openspec apply-change`，
必须在 feature worktree 执行。与治理 G1「master 执行入口」对称——
治理必须在 master 分支执行，ops 必须在 feature 分支执行。

用法:
    python worktree_ops_gate.py --dir <目录>

输入:
    --dir <目录>   判定目标目录（当前会话工作目录）

判定:
    branch == master    -> allowed=false（master 分支禁止生成/实施 change）
    非 git 仓库         -> allowed=false（无法解析分支，保守拒绝）
    feature/* / HEAD(detached) / 其他分支 -> allowed=true

输出: JSON（stdout）—— { allowed, branch, worktree_dir, reason }
    allowed=false 表示门禁未过，调用方 SHALL 停下报告 reason，不执行后续操作。
"""

import argparse
import json
import subprocess
import sys


def normalize(p: str) -> str:
    """路径归一化：统一为正斜杠（与 inventory/gate 口径一致，防御不同来源路径）。"""
    if not p:
        return p
    return p.replace("\\", "/").rstrip("/")


def git(dirpath, *args):
    """git -C <dirpath> <args...>：显式锁定仓库目录。"""
    try:
        proc = subprocess.run(
            ["git", "-C", str(dirpath)] + list(args),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return proc.returncode, proc.stdout, proc.stderr
    except FileNotFoundError:
        return 127, "", "command not found"


def resolve_branch(dirpath):
    """解析目录所在仓库的当前分支；非 git 仓库返回空串。"""
    code, out, _ = git(dirpath, "rev-parse", "--abbrev-ref", "HEAD")
    if code != 0:
        return ""
    return out.strip()


def judge(worktree_dir, branch):
    """纯判定：输入目录与分支，输出门禁结果（allowed/branch/worktree_dir/reason）。"""
    worktree_dir = normalize(worktree_dir)
    if not branch:
        return {
            "allowed": False,
            "branch": "",
            "worktree_dir": worktree_dir,
            "reason": "非 git 仓库（无法解析分支），保守拒绝；请在 git 仓库的 feature worktree 中执行",
        }
    if branch == "master":
        return {
            "allowed": False,
            "branch": branch,
            "worktree_dir": worktree_dir,
            "reason": "master 分支禁止生成/实施 change（new/propose/apply），请在 feature worktree 中执行",
        }
    return {
        "allowed": True,
        "branch": branch,
        "worktree_dir": worktree_dir,
        "reason": "",
    }


def main():
    ap = argparse.ArgumentParser(description="master worktree 操作门禁（生成/实施 change 用）")
    ap.add_argument("--dir", required=True, help="判定目标目录（当前会话工作目录）")
    a = ap.parse_args()

    branch = resolve_branch(a.dir)
    result = judge(a.dir, branch)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
