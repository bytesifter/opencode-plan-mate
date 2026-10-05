#!/usr/bin/env python3
"""worktree_merge_check —— 合并门禁检查（G3 测试完整性判定，单一权威，纯标准库）

对「合并 feature→master」施加门禁判定：在 feature worktree 侧读取 change 的
测试计划（`dev-notes/test-plans/<feature>/`）声明与测试报告
（`dev-notes/test-reports/<feature>/`），按「计划承诺 -> 报告兑现」逐层判定
（G3 测试完整性）。

判定口径（与 `and-integrate/references/integration-standards.md` §三 G3 一致）：
  - change 任务完整性（档位 1「三类任务勾选」，两档共用）：tasks.md 有未勾选任务 -> 阻断
  - 档位 1（无代码实现任务）：跳过 G3，不阻断（D1）
  - 档位 2（含代码实现任务）：
      - 测试计划缺失 -> 视为声明全部三层需要，缺失即阻断（D3 从严）
      - 计划声明「需要该层」：报告存在且 0 失败 -> 通过；
        报告缺失 / 记未执行 -> 阻断（承诺未兑现）；
        报告存在但有失败 -> 阻断
      - 计划声明「不需要该层」：报告缺失 -> 通过（按需豁免）

本模块只做**确定性判定**（文件存在性 + 报告失败数解析）；
语义性检查（技术方案内容完整、文档豁免有效性、OCR）由 `and-integrate` AI 门禁层补充（D7）。

用法:
    python worktree_merge_check.py --dir <feature worktree> --change <name>

输入:
    --dir <dir>        feature worktree 根目录（读 dev-notes/test-plans 与 test-reports）
    --change <name>    change 名（feature 目录名 = change 名）

输出: JSON（stdout）—— { allowed, tier, reasons[], per_layer: {...} }
    allowed=false 表示门禁未过，调用方 SHALL 停下报告 reasons，不执行合并。
"""

import argparse
import json
import re
import sys
from pathlib import Path


LAYERS = ("unit", "integration", "e2e")

# 每层在测试计划文本中的识别关键词（中文为主，兼容英文）
LAYER_KEYWORDS = {
    "unit": ["单元", "unit"],
    "integration": ["系统内", "集成", "integration"],
    "e2e": ["端到端", "e2e"],
}

# 报告「未执行」标记关键词（AGENTS-test §3.2：未执行阶段报告记「未执行」或缺省）
NOT_EXECUTED_MARKERS = ("未执行", "未跑", "not executed")


def normalize(p: str) -> str:
    """路径归一化：统一为正斜杠（与 inventory/gate 口径一致）。"""
    if not p:
        return p
    return p.replace("\\", "/").rstrip("/")


def plan_text_of(dirpath: Path) -> str:
    """读取测试计划目录文本：<dir>/dev-notes/test-plans/<feature>/ 下全部 .md 内容。"""
    plan_dir = dirpath / "dev-notes" / "test-plans"
    if not plan_dir.is_dir():
        return ""
    parts = []
    for p in plan_dir.rglob("*.md"):
        try:
            parts.append(p.read_text(encoding="utf-8-sig", errors="replace"))
        except OSError:
            continue
    return "\n".join(parts)


def extract_declared_layers(plan_text: str) -> set:
    """从测试计划文本提取声明需要验证的测试层（关键词命中即声明）。

    计划未提及某层 = 未声明需要（按需豁免口径，D2）。计划缺失（空文本）
    由调用方按 D3 从严处理，不在此兜底。
    """
    declared = set()
    if not plan_text:
        return declared
    for layer, kws in LAYER_KEYWORDS.items():
        if any(kw in plan_text for kw in kws):
            declared.add(layer)
    return declared


def parse_failures(report_text: str) -> str:
    """解析报告文本的失败状态：pass / fail / not_executed / unknown。

    - 含「未执行」标记 -> not_executed（承诺未兑现，阻断）
    - 匹配「失败[:：]\\s*<数字>」-> 数字>0 为 fail，否则 pass
    - 其余 -> unknown（存在性已证，达标性交 AI 层复核，不据此阻断）
    """
    if any(m in report_text for m in NOT_EXECUTED_MARKERS):
        return "not_executed"
    m = re.search(r"失败\s*[:：]\s*(\d+)", report_text)
    if m:
        return "fail" if int(m.group(1)) > 0 else "pass"
    return "unknown"


def report_status(report_dir: Path, layer: str) -> str:
    """单层报告状态：missing / pass / fail / not_executed / unknown。"""
    report = report_dir / f"{layer}-report.md"
    if not report.is_file():
        return "missing"
    return parse_failures(report.read_text(encoding="utf-8-sig", errors="replace"))


def task_completeness(change_dir):
    """change 任务完整性：读 change 目录下 `tasks.md`，统计 done/total。

    计数全部任务行（`- [x]` / `- [ ]`）。返回 `{total, done, incomplete}`。
    供门禁「档位 1 三类任务勾选」判据与 and-verify 前置门禁同源消费。
    """
    tasks_file = Path(change_dir) / "tasks.md"
    if not tasks_file.is_file():
        return {"total": 0, "done": 0, "incomplete": 0}
    try:
        text = tasks_file.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return {"total": 0, "done": 0, "incomplete": 0}
    total = done = 0
    for line in text.splitlines():
        head = line.strip()[:5].lower()
        if head in ("- [x]", "- [ ]"):
            total += 1
            if head == "- [x]":
                done += 1
    return {"total": total, "done": done, "incomplete": total - done}


def judge(dirpath, feature, has_code_tasks, change_dir=None):
    """门禁判定：change 任务完整性（档位 1）+ G3 测试完整性（档位 2）。

    `change_dir` 给定时附带任务完整性判定（两档共用）；未给定时只判 G3（向后兼容）。
    """
    dirpath = Path(dirpath)
    report_dir = dirpath / "dev-notes" / "test-reports" / feature
    plan_text = plan_text_of(dirpath)

    reasons = []

    # change 任务完整性（档位 1「三类任务勾选」判据；两档共用）
    task_comp = None
    if change_dir is not None:
        task_comp = task_completeness(change_dir)
        if task_comp["incomplete"] > 0:
            reasons.append(
                f"change 任务未完成（{task_comp['done']}/{task_comp['total']}，缺 {task_comp['incomplete']}）"
            )

    # 档位 1：无代码实现任务，跳过 G3（D1）
    if not has_code_tasks:
        return {
            "allowed": len(reasons) == 0,
            "tier": 1,
            "reasons": reasons,
            "per_layer": {},
            "task_completeness": task_comp,
        }

    # 档位 2：测试计划缺失 -> 视为声明全部层需要（D3 从严）
    declared = extract_declared_layers(plan_text) if plan_text else set(LAYERS)
    plan_missing = not plan_text

    per_layer = {}
    for layer in LAYERS:
        if layer not in declared:
            per_layer[layer] = "skipped"
            continue
        status = report_status(report_dir, layer)
        per_layer[layer] = status
        if status == "pass" or status == "unknown":
            # unknown：报告存在但格式未解析出失败数，存在性已证，不据此阻断
            continue
        if status == "missing":
            reasons.append(f"{layer}-report.md 缺失（计划承诺未兑现）")
        elif status == "not_executed":
            reasons.append(f"{layer} 报告记「未执行」（承诺未兑现）")
        elif status == "fail":
            reasons.append(f"{layer} 报告存在但有失败")

    if plan_missing:
        reasons.append("测试计划缺失，无法确认验证范围（默认需全部测试层）")

    return {
        "allowed": len(reasons) == 0,
        "tier": 2,
        "reasons": reasons,
        "per_layer": per_layer,
        "task_completeness": task_comp,
    }


def has_code_tasks(change_dir: Path) -> bool:
    """change 是否含「代码实现」类任务：读 tasks.md，任务描述含「实现」关键词。

    tasks 三类任务归类按 `AGENTS-test.md` §四.1（实现 -> 代码实现）。
    任务文本含「实现」即视为有代码实现任务（档位 2 判据，D1）。
    统计全部任务行（含已勾选 [x]——complete change 任务均已勾选），
    只看任务是否属「代码实现」类，不看完成状态。
    """
    tasks_file = change_dir / "tasks.md"
    if not tasks_file.is_file():
        return False
    try:
        # utf-8-sig：容忍 Windows 工具写入的 BOM（Set-Content -Encoding utf8 带 BOM）
        text = tasks_file.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return False
    for line in text.splitlines():
        line = line.strip()
        # 任务行：- [x] / - [X] / - [ ] 开头（勾选与否都统计，只看是否含「实现」）
        head = line[:5].lower()
        if head not in ("- [x]", "- [ ]"):
            continue
        if "实现" in line:
            return True
    return False


def main():
    ap = argparse.ArgumentParser(description="合并门禁检查（G3 测试完整性判定）")
    ap.add_argument("--dir", required=True, help="feature worktree 根目录")
    ap.add_argument("--change", required=True, help="change 名（test-plans/test-reports 的 feature 目录名）")
    ap.add_argument("--changes-dir", default="openspec/changes",
                    help="openspec changes 目录相对路径（定位 change tasks.md，默认 openspec/changes）")
    ap.add_argument("--completeness-only", action="store_true",
                    help="只输出 change 任务完整性判定（供 and-verify 前置门禁消费）")
    a = ap.parse_args()

    dirpath = Path(a.dir)
    change_dir = dirpath / a.changes_dir / a.change
    if a.completeness_only:
        print(json.dumps(task_completeness(change_dir), ensure_ascii=False, indent=2))
        return 0
    result = judge(a.dir, a.change, has_code_tasks(change_dir), change_dir=change_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
