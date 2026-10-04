#!/usr/bin/env python3
"""worktree_merge_check.py 单元测试（pytest）。

覆盖 G3 测试完整性判据（计划承诺 -> 报告兑现，design D2/D3/D1）：
  - 计划声明需 unit/integration/e2e 且报告 0 失败 -> 通过
  - 声明层报告缺失 -> 阻断且 reasons 含该层
  - 报告存在但有失败 -> 阻断
  - 计划声明不需要的层报告缺失 -> 通过（按需豁免）
  - 测试计划目录缺失 -> 按默认需全部层从严阻断
  - 报告记「未执行」-> 阻断（承诺未兑现）
  - 无代码任务 change（档位 1）-> 跳过 G3 不阻断
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worktree_merge_check  # noqa: E402


def _write(tmp_path, rel, content=""):
    """在 tmp_path 下写相对路径文件并返回其 Path。"""
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if content:
        p.write_text(content, encoding="utf-8")
    return p


PLAN = "dev-notes/test-plans/feature-x/README.md"
REPORT = "dev-notes/test-reports/feature-x"


def test_all_declared_layers_pass():
    """计划声明 unit/integration/e2e，三层报告均 0 失败 -> 通过。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _write(root, PLAN, "分层映射：单元测试、系统内测试、端到端测试\n")
        for layer in ("unit", "integration", "e2e"):
            _write(root, f"{REPORT}/{layer}-report.md", "用例数 10 / 通过 10 / 失败: 0\n")
        r = worktree_merge_check.judge(root, "feature-x", has_code_tasks=True)
        assert r["allowed"] is True
        assert r["tier"] == 2
        assert r["reasons"] == []
        assert r["per_layer"]["unit"] == "pass"
        assert r["per_layer"]["integration"] == "pass"
        assert r["per_layer"]["e2e"] == "pass"


def test_declared_layer_missing_report_blocks():
    """计划声明需要 unit，unit-report 缺失 -> 阻断且 reasons 含该层。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _write(root, PLAN, "分层映射：单元测试\n")
        _write(root, f"{REPORT}/integration-report.md", "失败: 0\n")
        _write(root, f"{REPORT}/e2e-report.md", "失败: 0\n")
        r = worktree_merge_check.judge(root, "feature-x", has_code_tasks=True)
        assert r["allowed"] is False
        assert r["per_layer"]["unit"] == "missing"
        assert any("unit" in reason and "缺失" in reason for reason in r["reasons"])


def test_report_with_failures_blocks():
    """声明层报告存在但有失败 -> 阻断。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _write(root, PLAN, "分层映射：单元测试\n")
        _write(root, f"{REPORT}/unit-report.md", "用例数 10 / 通过 8 / 失败: 2\n")
        r = worktree_merge_check.judge(root, "feature-x", has_code_tasks=True)
        assert r["allowed"] is False
        assert r["per_layer"]["unit"] == "fail"
        assert any("失败" in reason for reason in r["reasons"])


def test_undeclared_layer_missing_report_allowed():
    """计划只声明 unit，integration/e2e 报告缺失 -> 通过（按需豁免）。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _write(root, PLAN, "分层映射：单元测试\n")
        _write(root, f"{REPORT}/unit-report.md", "失败: 0\n")
        r = worktree_merge_check.judge(root, "feature-x", has_code_tasks=True)
        assert r["allowed"] is True
        assert r["per_layer"]["integration"] == "skipped"
        assert r["per_layer"]["e2e"] == "skipped"


def test_missing_plan_blocks_all_layers():
    """测试计划目录缺失 -> 默认需全部层，缺报告即阻断。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _write(root, f"{REPORT}/unit-report.md", "失败: 0\n")
        r = worktree_merge_check.judge(root, "feature-x", has_code_tasks=True)
        assert r["allowed"] is False
        assert r["per_layer"]["unit"] == "pass"
        assert r["per_layer"]["integration"] == "missing"
        assert r["per_layer"]["e2e"] == "missing"
        assert any("测试计划缺失" in reason for reason in r["reasons"])


def test_not_executed_report_blocks():
    """报告记「未执行」-> 阻断（承诺未兑现，design D2 判定表）。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _write(root, PLAN, "分层映射：单元测试、端到端测试\n")
        _write(root, f"{REPORT}/unit-report.md", "失败: 0\n")
        _write(root, f"{REPORT}/e2e-report.md", "未执行（环境未就绪）\n")
        r = worktree_merge_check.judge(root, "feature-x", has_code_tasks=True)
        assert r["allowed"] is False
        assert r["per_layer"]["e2e"] == "not_executed"


def test_no_code_tasks_tier1_skips_g3():
    """无代码实现任务（档位 1）-> 跳过 G3，无报告也不阻断。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        r = worktree_merge_check.judge(root, "feature-x", has_code_tasks=False)
        assert r["allowed"] is True
        assert r["tier"] == 1
        assert r["reasons"] == []
        assert r["per_layer"] == {}


def test_parse_failures_helpers():
    """parse_failures 四态：pass / fail / not_executed / unknown。"""
    assert worktree_merge_check.parse_failures("失败: 0") == "pass"
    assert worktree_merge_check.parse_failures("失败: 3") == "fail"
    assert worktree_merge_check.parse_failures("失败：0") == "pass"  # 中文冒号
    assert worktree_merge_check.parse_failures("未执行") == "not_executed"
    assert worktree_merge_check.parse_failures("通过 10 条") == "unknown"


def test_has_code_tasks_detects_checked_and_unchecked():
    """has_code_tasks 统计全部任务行（含已勾选 [x]，complete change 常态）。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        # 已勾选代码实现任务（complete change）
        p = root / "openspec" / "changes" / "c1" / "tasks.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("- [x] 1.1 实现登录功能\n- [x] 1.2 编写登录测试\n", encoding="utf-8")
        assert worktree_merge_check.has_code_tasks(p.parent) is True
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        # 未勾选代码实现任务
        p = root / "openspec" / "changes" / "c2" / "tasks.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("- [ ] 1.1 实现导出功能\n", encoding="utf-8")
        assert worktree_merge_check.has_code_tasks(p.parent) is True
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        # 纯文档任务（无代码实现）-> 档位 1
        p = root / "openspec" / "changes" / "c3" / "tasks.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("- [x] 1.1 更新 README 文档\n- [x] 1.2 修订规范引用\n", encoding="utf-8")
        assert worktree_merge_check.has_code_tasks(p.parent) is False
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        # tasks.md 缺失 -> 无代码任务（档位 1）
        assert worktree_merge_check.has_code_tasks(root / "openspec" / "changes" / "c4") is False
