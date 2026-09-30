#!/usr/bin/env python3
"""worktree_ops_gate.py 单元测试（pytest）。

覆盖 master 分支拒绝 / feature 分支放行 / detached HEAD 放行 / 非 git 目录拒绝，
以及输出 JSON 字段完整性（allowed/branch/worktree_dir/reason）。
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worktree_ops_gate  # noqa: E402


def test_master_rejected():
    """master 分支必须拒绝，原因含 feature worktree 指引。"""
    result = worktree_ops_gate.judge("D:/repo", "master")
    assert result["allowed"] is False
    assert "feature worktree" in result["reason"]


def test_feature_allowed():
    """feature 分支放行。"""
    result = worktree_ops_gate.judge("D:/repo", "feature/abc")
    assert result["allowed"] is True
    assert result["branch"] == "feature/abc"


def test_detached_allowed():
    """detached HEAD（opencode 沙箱常态）放行。"""
    result = worktree_ops_gate.judge("D:/repo", "HEAD")
    assert result["allowed"] is True


def test_non_git_rejected():
    """空分支（非 git 仓库解析失败）保守拒绝。"""
    result = worktree_ops_gate.judge("D:/repo", "")
    assert result["allowed"] is False
    assert result["reason"]


def test_result_fields():
    """输出字段完整：allowed/branch/worktree_dir/reason。"""
    result = worktree_ops_gate.judge("D:\\repo\\sub", "feature/abc")
    assert set(result) == {"allowed", "branch", "worktree_dir", "reason"}
    # 路径归一化为正斜杠
    assert result["worktree_dir"] == "D:/repo/sub"


def test_cli_rejects_non_git_dir():
    """CLI 入口对非 git 目录输出 allowed=false 且 JSON 可解析。"""
    with tempfile.TemporaryDirectory() as d:
        proc = subprocess.run(
            [sys.executable, str(Path(worktree_ops_gate.__file__)), "--dir", d],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        assert proc.returncode == 0, proc.stderr
        out = json.loads(proc.stdout)
        assert out["allowed"] is False
        assert set(out) == {"allowed", "branch", "worktree_dir", "reason"}
