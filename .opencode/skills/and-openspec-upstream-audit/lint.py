#!/usr/bin/env python3
"""audit-openspec L1 上游引用完整性检查器（确定性）

确定性检查 openspec change 的 proposal.md 是否引用其上游各层文档：
  - 收集 proposal 中引用的、且仓库中真实存在的上游文档锚点
  - 按运行时抽取的层定义（由规范定位步骤提供）判定各层是否被引用
  - 未引用但已显式声明缺位 -> warning；未引用且未声明 -> error

层定义由调用方以 JSON 提供（--layers），本脚本**不写死任何层名、路径或关键字**。
纯标准库实现，无外部依赖。

用法:
    python lint.py <change-dir> [--layers <layers.json>] [--format json|text]

<change-dir> 须含 proposal.md。--layers 为 JSON 数组：
    [{"id": "vision", "label": "愿景层", "patterns": ["roadmap"]}, ...]
patterns 为对锚点路径的大小写不敏感子串匹配。输出 JSON 字段名英文，问题描述值中文。
"""

import sys
import json
import re
import argparse
from pathlib import Path

# 通用 markdown 路径引用（不限定目录；具体层由 --layers 定义）
RE_MD_PATH = re.compile(r"[\w./-]+\.md")


def make_finding(layer, label, issue, severity="error"):
    """构造一条检查结果。"""
    return {
        "layer": layer,
        "rule": f"upstream-{layer}-ref",
        "severity": severity,
        "issue": issue,
    }


def find_proposal(change_dir: Path):
    """定位 proposal.md（change 根目录）。"""
    candidate = change_dir / "proposal.md"
    return candidate if candidate.is_file() else None


def find_repo_root(proposal: Path):
    """从 proposal 路径反推仓库根：change 目录向上三级即仓库根。"""
    return proposal.parents[3]


def collect_anchors(text: str, repo_root: Path):
    """收集 proposal 中引用的、且仓库中真实存在的 markdown 文档锚点。"""
    anchors = []
    seen = set()
    for m in RE_MD_PATH.finditer(text):
        p = m.group(0).strip(".,;:，。；：")
        if p in seen:
            continue
        if (repo_root / p).is_file():
            seen.add(p)
            anchors.append(p)
    return anchors


def match_layer(anchor: str, patterns):
    """锚点是否命中某层的落点模式（大小写不敏感子串）。"""
    low = anchor.lower()
    return any(bool(p) and p.lower() in low for p in patterns)


def check_layers(text: str, anchors, layers):
    """按抽取的层定义逐层检查引用与缺位声明。"""
    findings = []
    for layer in layers:
        lid = layer.get("id") or layer.get("label")
        label = layer.get("label") or lid
        patterns = layer.get("patterns") or []
        matched = next((a for a in anchors if match_layer(a, patterns)), None)
        if matched:
            findings.append(make_finding(
                lid, label,
                f"{label}已引用上游锚点「{matched}」",
                severity="ok",
            ))
            continue
        # 缺位声明：proposal 显式声明该层不存在
        absent = re.search(
            rf"{re.escape(label)}[^。\n]{{0,12}}(不存在|缺位|无(?:对应)?)", text
        )
        if absent:
            findings.append(make_finding(
                lid, label,
                f"{label}引用缺失，但 proposal 已显式声明缺位（声明缺位但已说明）",
                severity="warning",
            ))
        else:
            findings.append(make_finding(
                lid, label,
                f"{label}引用缺失，且未声明该层不存在——判存在性缺失",
            ))
    return findings


def main():
    ap = argparse.ArgumentParser(description="L1 上游引用完整性检查（存在性维度）")
    ap.add_argument("change_dir", help="待审计的 openspec change 目录（须含 proposal.md）")
    ap.add_argument("--layers", help="运行时抽取的层定义 JSON（缺省则只收集锚点）")
    ap.add_argument("--format", choices=["json", "text"], default="json")
    args = ap.parse_args()

    path = Path(args.change_dir)
    proposal = find_proposal(path)
    if proposal is None:
        result = {
            "error": f"未找到 proposal.md（在 {path}）",
            "summary": {"errors": 1, "warnings": 0},
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(2)

    repo_root = find_repo_root(proposal)
    text = proposal.read_text(encoding="utf-8")
    anchors = collect_anchors(text, repo_root)

    layers = None
    note = None
    if args.layers:
        layers = json.loads(Path(args.layers).read_text(encoding="utf-8"))
    else:
        note = "未提供层定义（--layers），仅收集锚点，不做层完整性判定"

    findings = check_layers(text, anchors, layers) if layers else []

    errors = sum(1 for f in findings if f["severity"] == "error")
    warnings = sum(1 for f in findings if f["severity"] == "warning")
    result = {
        "file": str(proposal),
        "repo_root": str(repo_root),
        "anchors": anchors,
        "findings": findings,
        "note": note,
        "summary": {"errors": errors, "warnings": warnings},
    }

    if args.format == "text":
        print(f"proposal: {proposal}")
        print(f"锚点: {anchors or '无'}")
        if note:
            print(f"提示: {note}")
        print(f"错误 {errors}  警告 {warnings}")
        for f in findings:
            print(f"  [{f['severity']}] {f['layer']}: {f['issue']}")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))

    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
