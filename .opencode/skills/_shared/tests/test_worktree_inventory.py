#!/usr/bin/env python3
"""worktree_inventory.py 关联逻辑单元测试（pytest）。

覆盖 `change_to_branch` 的「命名匹配 ∪ diff 派生」补充：一分支多 change（搭车）时，
非命名匹配的 change 也能被关联到其携带分支。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worktree_inventory  # noqa: E402


def test_branch_touched_changes_parses_and_excludes_archive(monkeypatch):
    """diff 输出解析：取 openspec/changes/<name>/ 直接子目录，排除 archive/。"""
    def fake_git(dirpath, *args):
        assert "master...feature/x" in args
        out = "\n".join([
            "src/a.ts",
            "openspec/changes/foo/tasks.md",
            "openspec/changes/bar/proposal.md",
            "openspec/changes/archive/2026-01-01-old/spec.md",
        ])
        return 0, out, ""

    monkeypatch.setattr(worktree_inventory, "git", fake_git)
    assert worktree_inventory.branch_touched_changes("feature/x", "D:/repo") == {"foo", "bar"}


def test_branch_touched_changes_empty_on_git_failure(monkeypatch):
    """git diff 失败 -> 空集（不误关联）。"""
    monkeypatch.setattr(worktree_inventory, "git", lambda *a, **k: (1, "", "err"))
    assert worktree_inventory.branch_touched_changes("feature/x", "D:/repo") == set()


def test_correlation_multi_change_branch(monkeypatch):
    """一分支多 change：foo/bar（非命名匹配）经 diff 关联到 feature/x。"""
    monkeypatch.setattr(worktree_inventory, "fetch_changes",
                        lambda *a, **k: ([{"name": "foo", "status": "complete"},
                                          {"name": "bar", "status": "complete"}], "cli"))
    monkeypatch.setattr(worktree_inventory, "fetch_sessions", lambda *a, **k: ([], "cli"))
    monkeypatch.setattr(worktree_inventory, "fetch_worktrees_api", lambda *a, **k: [])
    monkeypatch.setattr(worktree_inventory, "fetch_git_worktrees", lambda *a, **k: [])
    monkeypatch.setattr(worktree_inventory, "fetch_feature_branches",
                        lambda *a, **k: [{"name": "feature/x",
                                          "committerdate_unix": "0",
                                          "committerdate_iso": "2026-01-01"}])
    monkeypatch.setattr(worktree_inventory, "merged_into_master", lambda *a, **k: False)
    monkeypatch.setattr(worktree_inventory, "branch_touched_changes",
                        lambda *a, **k: {"foo", "bar"})

    inv = worktree_inventory.build_inventory("proj", "D:/repo")
    mapping = {c["change"]: c["branch"] for c in inv["correlations"]["change_to_branch"]}
    assert mapping == {"foo": "feature/x", "bar": "feature/x"}


def test_correlation_name_match_wins(monkeypatch):
    """命名匹配优先：feature/foo 存在时 foo 关联到它，不走 diff。"""
    monkeypatch.setattr(worktree_inventory, "fetch_changes",
                        lambda *a, **k: ([{"name": "foo", "status": "complete"}], "cli"))
    monkeypatch.setattr(worktree_inventory, "fetch_sessions", lambda *a, **k: ([], "cli"))
    monkeypatch.setattr(worktree_inventory, "fetch_worktrees_api", lambda *a, **k: [])
    monkeypatch.setattr(worktree_inventory, "fetch_git_worktrees", lambda *a, **k: [])
    monkeypatch.setattr(worktree_inventory, "fetch_feature_branches",
                        lambda *a, **k: [{"name": "feature/foo",
                                          "committerdate_unix": "0",
                                          "committerdate_iso": "2026-01-01"}])
    monkeypatch.setattr(worktree_inventory, "merged_into_master", lambda *a, **k: False)
    monkeypatch.setattr(worktree_inventory, "branch_touched_changes", lambda *a, **k: set())

    inv = worktree_inventory.build_inventory("proj", "D:/repo")
    mapping = {c["change"]: c["branch"] for c in inv["correlations"]["change_to_branch"]}
    assert mapping == {"foo": "feature/foo"}
