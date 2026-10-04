#!/usr/bin/env python3
"""worktree_classify.py 单元测试（pytest）。

覆盖本 change 新增字段：`pending_merge` 对象含 `reasons: []` 字段且默认空，
孤儿分支 / in-progress 分支标注不受影响。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worktree_classify  # noqa: E402


def _inventory(git_worktrees=None, feature_branches=None, changes=None,
               correlations=None, master_dir="D:/repo", sessions=None):
    return {
        "master_dir": master_dir,
        "sessions": sessions or [],
        "git_worktrees": git_worktrees or [],
        "feature_branches": feature_branches or [],
        "correlations": correlations or {"change_to_branch": []},
        "changes": changes or [],
        "gate": {},
    }


def test_pending_merge_has_empty_reasons():
    """未合并干净 feature 分支 -> pending_merge=true 且 reasons 为空列表。"""
    inv = _inventory(
        git_worktrees=[{
            "directory": "D:/repo/feat", "branch": "feature/x",
            "detached": False, "dirty": False, "in_merge": False,
            "is_master": False,
        }],
        feature_branches=[{"name": "feature/x", "merged_to_master": False}],
    )
    result = worktree_classify.decide(inv, idle_days=15)
    obj = result["objects"][0]
    assert obj["pending_merge"] is True
    assert obj["reasons"] == []
    assert obj["object_type"] == "worktree"


def test_pending_merge_branch_without_sandbox_has_empty_reasons():
    """无沙箱未合并 feature 分支 -> pending_merge=true 且 reasons 为空。"""
    inv = _inventory(
        feature_branches=[{"name": "feature/y", "merged_to_master": False}],
    )
    result = worktree_classify.decide(inv, idle_days=15)
    obj = result["objects"][0]
    assert obj["pending_merge"] is True
    assert obj["reasons"] == []
    assert obj["object_type"] == "branch"


def test_orphan_branch_pending_merge_has_empty_reasons():
    """孤儿未合并分支 -> pending_merge=true（无 change 关联，reasons 空）。"""
    inv = _inventory(
        git_worktrees=[{
            "directory": "D:/repo/feat", "branch": "feature/orphan",
            "detached": False, "dirty": False, "in_merge": False,
            "is_master": False,
        }],
        feature_branches=[{"name": "feature/orphan", "merged_to_master": False}],
    )
    result = worktree_classify.decide(inv, idle_days=15)
    obj = result["objects"][0]
    assert obj["orphan"] is True
    assert obj["pending_merge"] is True
    assert obj["reasons"] == []


def test_in_progress_branch_not_pending_merge():
    """in-progress change 分支 -> 不标 pending_merge（迭代在飞）。"""
    inv = _inventory(
        git_worktrees=[{
            "directory": "D:/repo/feat", "branch": "feature/z",
            "detached": False, "dirty": False, "in_merge": False,
            "is_master": False,
        }],
        feature_branches=[{"name": "feature/z", "merged_to_master": False}],
        changes=[{"name": "z", "status": "in-progress"}],
        correlations={"change_to_branch": [{"change": "z", "branch": "feature/z", "status": "in-progress"}]},
    )
    result = worktree_classify.decide(inv, idle_days=15)
    obj = result["objects"][0]
    assert obj["pending_merge"] is False
    assert obj["reasons"] == []


def test_non_pending_objects_have_reasons_field():
    """非 pending_merge 对象（master 入口）也含 reasons 字段（统一契约）。"""
    inv = _inventory(
        git_worktrees=[{
            "directory": "D:/repo", "branch": "master",
            "detached": False, "dirty": False, "in_merge": False,
            "is_master": True,
        }],
    )
    result = worktree_classify.decide(inv, idle_days=15)
    obj = result["objects"][0]
    assert obj["is_master"] is True
    assert "reasons" in obj
    assert obj["reasons"] == []
