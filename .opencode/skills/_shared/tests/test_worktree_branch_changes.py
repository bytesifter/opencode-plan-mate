#!/usr/bin/env python3
"""worktree_branch_changes.py 单元测试（pytest）。

覆盖：命名匹配 ∪ diff 派生、archive 排除、非 feature 分支返回空。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worktree_branch_changes as wbc  # noqa: E402


def test_diff_changes_parses_and_excludes_archive(monkeypatch):
    """diff 输出解析：取 openspec/changes/<name>/ 直接子目录，排除 archive/。"""
    def fake_git(dirpath, *args):
        assert "master...HEAD" in args
        return 0, (
            "src/a.ts\n"
            "openspec/changes/foo/tasks.md\n"
            "openspec/changes/bar/proposal.md\n"
            "openspec/changes/archive/2026-01-01-old/spec.md\n"
        ), ""

    monkeypatch.setattr(wbc, "git", fake_git)
    assert wbc.diff_changes("D:/wt", "master") == {"foo", "bar"}


def test_named_change():
    assert wbc.named_change("feature/foo") == "foo"
    assert wbc.named_change("master") is None
    assert wbc.named_change("") is None


def test_collect_union_named_and_diff(monkeypatch):
    """命名匹配 feature/x ∪ diff 命中 y -> {x, y}，附状态。"""
    monkeypatch.setattr(wbc, "branch_name", lambda d: "feature/x")
    monkeypatch.setattr(wbc, "diff_changes", lambda d, b: {"y"})
    monkeypatch.setattr(wbc, "change_statuses", lambda d, o="openspec": {"x": "complete", "y": "in-progress"})
    r = wbc.collect("D:/wt", "master")
    assert r == [{"change": "x", "status": "complete"}, {"change": "y", "status": "in-progress"}]


def test_collect_non_feature_no_diff(monkeypatch):
    """非 feature 分支且无 diff -> 空。"""
    monkeypatch.setattr(wbc, "branch_name", lambda d: "master")
    monkeypatch.setattr(wbc, "diff_changes", lambda d, b: set())
    monkeypatch.setattr(wbc, "change_statuses", lambda d, o="openspec": {})
    assert wbc.collect("D:/wt", "master") == []


def test_collect_unknown_status(monkeypatch):
    """change 不在 openspec list 中 -> status unknown。"""
    monkeypatch.setattr(wbc, "branch_name", lambda d: "feature/z")
    monkeypatch.setattr(wbc, "diff_changes", lambda d, b: set())
    monkeypatch.setattr(wbc, "change_statuses", lambda d, o="openspec": {})
    assert wbc.collect("D:/wt", "master") == [{"change": "z", "status": "unknown"}]
