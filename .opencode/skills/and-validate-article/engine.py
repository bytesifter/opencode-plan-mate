#!/usr/bin/env python3
"""validate-article 固定解释器（engine）

执行由 LLM 从规范抽取的规则集（ruleset.json）中的机械规则（mode=machine）；
语义规则（mode=llm）原样输出为待判清单；无法映射到原语的规则记入
coverage_gaps 并回落为待判项。本文件**不内嵌任何规范内容**，只认识有限原语。

用法:
    python engine.py <article.md> --ruleset <ruleset.json> [--fix] [--format json|text]

规则集 schema:
    {"schema_version": int, "source_hash": str,
     "rules": [{"id","mode":"machine|llm","primitive"?,"params"?,"severity",
                "dimension","norm","fix"?,"desc"}],
     "coverage_gaps": [{"id","reason","norm"}]}

输出字段名英文，问题描述值中文。
"""

import sys
import json
import re
import argparse
from pathlib import Path

ISA_VERSION = "1"

# ── 原语依赖的基础正则（通用语法，非规范内容）────────────────────────
RE_HEADING = re.compile(r"^(#{1,6})\s+\S")
RE_FENCE = re.compile(r"^( {0,3})(`{3,}|~{3,})\s*(\S*)")
RE_THEMATIC = re.compile(r"^( {0,3})([-*_])\s*(\2\s*){2,}\s*$")
RE_H1 = re.compile(r"^#\s+(.+?)\s*$")
RE_KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*\.md$")
PUNCT = set("、，。！？；：,.!?;:\"'（）()【】[]《》\"\"''…—")


def parse_front_matter(lines):
    """返回 front matter 结束行号（0-based 不含），无则 0。"""
    if not lines or lines[0].strip() != "---":
        return 0
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return i + 1
    return 0


def _iter_scope(lines, fm_end, scope):
    """按 scope 产出 (lineno, line)：all | outside_fence | body | front_matter。"""
    in_fence = False
    fence_char = None
    for i, line in enumerate(lines):
        lineno = i + 1
        m = RE_FENCE.match(line)
        if m and not in_fence:
            in_fence = True
            fence_char = m.group(2)[0]
            if scope == "all":
                yield lineno, line
            continue
        if in_fence:
            if m and m.group(2)[0] == fence_char:
                in_fence = False
                fence_char = None
            if scope == "all":
                yield lineno, line
            continue
        if i < fm_end:
            if scope == "front_matter":
                yield lineno, line
            elif scope == "all":
                yield lineno, line
            continue
        if scope in ("all", "outside_fence", "body"):
            yield lineno, line


def make_finding(rule, issue, line=None, fixable=False):
    return {
        "dimension": rule.get("dimension"),
        "rule": rule.get("id"),
        "severity": rule.get("severity", "error"),
        "issue": issue,
        "line": line,
        "norm": rule.get("norm"),
        "fixable": fixable,
    }


def _is_setext(line, prev_line):
    m = RE_THEMATIC.match(line)
    if not m or m.group(2) not in "-=":
        return False
    prev = (prev_line or "").strip()
    return bool(prev) and not RE_HEADING.match(prev) and not RE_THEMATIC.match(prev) \
        and not RE_FENCE.match(prev)


def prim_regex_line_scan(rule, ctx):
    p = rule.get("params", {})
    pat = re.compile(p["pattern"])
    scope = p.get("scope", "body")
    exclude_setext = p.get("exclude_setext", False)
    desc = rule.get("desc") or rule.get("id")
    findings = []
    lines = ctx["lines"]
    for lineno, line in _iter_scope(lines, ctx["fm_end"], scope):
        if not pat.match(line):
            continue
        if exclude_setext and _is_setext(line, lines[lineno - 2] if lineno >= 2 else ""):
            continue
        findings.append(make_finding(
            rule, f"第 {lineno} 行：{desc}", lineno, bool(rule.get("fix"))))
    return findings


def prim_heading_sequence(rule, ctx):
    max_delta = rule.get("params", {}).get("max_delta", 1)
    desc = rule.get("desc") or "标题跳级"
    findings = []
    prev = None
    for lineno, line in _iter_scope(ctx["lines"], ctx["fm_end"], "body"):
        m = RE_HEADING.match(line)
        if not m:
            continue
        level = len(m.group(1))
        if prev is not None and level > prev + max_delta:
            findings.append(make_finding(
                rule, f"标题跳级：从 H{prev} 直接到 H{level}", lineno))
        prev = level
    return findings


def prim_code_fence_info(rule, ctx):
    required = rule.get("params", {}).get("required", True)
    desc = rule.get("desc") or "代码块未标注语言类型"
    findings = []
    in_fence = False
    fence_char = None
    for i, line in enumerate(ctx["lines"]):
        m = RE_FENCE.match(line)
        if m and not in_fence:
            in_fence = True
            fence_char = m.group(2)[0]
            if required and not m.group(3):
                findings.append(make_finding(rule, desc, i + 1))
            continue
        if in_fence and m and m.group(2)[0] == fence_char:
            in_fence = False
            fence_char = None
    return findings


def prim_filename_pattern(rule, ctx):
    pat = re.compile(rule.get("params", {})["pattern"])
    if not pat.match(ctx["filename"]):
        desc = rule.get("desc") or "文件名不符合模式"
        return [make_finding(rule, f"文件名「{ctx['filename']}」{desc}", 1)]
    return []


def prim_bytes_fact(rule, ctx):
    p = rule.get("params", {})
    kind = p.get("kind")
    expected = p.get("expected")
    raw = ctx["raw"]
    desc = rule.get("desc") or rule.get("id")
    if kind == "encoding" and expected:
        try:
            raw.decode(expected.replace("-", "_"))
        except (UnicodeDecodeError, LookupError):
            return [make_finding(rule, f"文件非 {expected} 编码", 1)]
        return []
    if kind == "bom":
        has_bom = raw.startswith(b"\xef\xbb\xbf")
        if (expected == "none" and has_bom) or (expected == "utf-8" and not has_bom):
            return [make_finding(rule, desc, 1)]
        return []
    if kind == "eol" and expected == "lf":
        if b"\r\n" in raw or b"\r" in raw:
            return [make_finding(rule, "换行符非 LF（含 CRLF/CR）", 1)]
        return []
    return []


def prim_wordlist_match(rule, ctx):
    p = rule.get("params", {})
    scope = p.get("scope", "heading")
    words = [w for w in p.get("words", []) if w]
    level = p.get("level")
    desc = rule.get("desc") or "命中词表"
    findings = []
    iter_scope = "body" if scope == "heading" else "body"
    for lineno, line in _iter_scope(ctx["lines"], ctx["fm_end"], iter_scope):
        if scope == "heading":
            m = RE_HEADING.match(line)
            if not m:
                continue
            if level and len(m.group(1)) != level:
                continue
        hit = next((w for w in words if w in line), None)
        if hit:
            findings.append(make_finding(rule, f"命中「{hit}」：{desc}", lineno))
    return findings


def _paragraphs(lines, fm_end):
    """散文段落定位：返回 (start_lineno, [行文本])，跳过标题/表格/列表/引用/分割线。"""
    paras = []
    buf = []
    buf_start = None
    for i, line in enumerate(lines):
        s = line.strip()
        if i < fm_end:
            continue
        if not s or RE_HEADING.match(line) or RE_THEMATIC.match(line) \
                or s.startswith("|") or s.startswith(">") \
                or re.match(r"^\s*([-*+]|\d+\.)\s", s):
            if buf:
                paras.append((buf_start, buf))
                buf = []
            continue
        if not buf:
            buf_start = i + 1
        buf.append(s)
    if buf:
        paras.append((buf_start, buf))
    return paras


def prim_paragraph_stat(rule, ctx):
    p = rule.get("params", {})
    kind = p.get("kind")
    min_len = p.get("min_len", 0)
    if kind == "no_blank":
        body = ctx["text"].rstrip("\n")
        if len(body) > min_len and "\n\n" not in body:
            return [make_finding(rule, "全文无空行分段，疑似排版混乱", 1)]
        return []
    if kind == "no_punct":
        # 去掉代码块内与 front matter，取散文段落
        lines = ctx["lines"]
        prose = []
        in_fence = False
        fence_char = None
        for i, line in enumerate(lines):
            m = RE_FENCE.match(line)
            if m and not in_fence:
                in_fence = True
                fence_char = m.group(2)[0]
                continue
            if in_fence:
                if m and m.group(2)[0] == fence_char:
                    in_fence = False
                    fence_char = None
                continue
            prose.append(line)
        findings = []
        for start, plines in _paragraphs(prose, ctx["fm_end"]):
            joined = "".join(plines)
            if len(joined) >= min_len and not any(c in PUNCT for c in joined):
                findings.append(make_finding(
                    rule, f"第 {start} 行起的段落较长且无明显标点，疑似排版混乱", start))
        return findings
    return []


PRIMITIVES = {
    "regex_line_scan": prim_regex_line_scan,
    "heading_sequence": prim_heading_sequence,
    "code_fence_info": prim_code_fence_info,
    "filename_pattern": prim_filename_pattern,
    "bytes_fact": prim_bytes_fact,
    "wordlist_match": prim_wordlist_match,
    "paragraph_stat": prim_paragraph_stat,
}


def run(ruleset, path, raw, text):
    """执行规则集，返回 (findings, llm_rules, coverage_gaps)。"""
    lines = text.split("\n")
    ctx = {
        "lines": lines,
        "text": text,
        "raw": raw,
        "filename": path.name,
        "fm_end": parse_front_matter(lines),
    }
    findings = []
    llm_rules = []
    gaps = [dict(g) for g in ruleset.get("coverage_gaps", [])]
    for rule in ruleset.get("rules", []):
        mode = rule.get("mode", "machine")
        if mode == "llm":
            llm_rules.append({
                "id": rule.get("id"), "dimension": rule.get("dimension"),
                "norm": rule.get("norm"), "desc": rule.get("desc"),
            })
            continue
        fn = PRIMITIVES.get(rule.get("primitive"))
        if fn is None:
            gaps.append({
                "id": rule.get("id"),
                "reason": f"无法映射原语「{rule.get('primitive')}」，已回落 AI 判定",
                "norm": rule.get("norm"),
            })
            llm_rules.append({
                "id": rule.get("id"), "dimension": rule.get("dimension"),
                "norm": rule.get("norm"), "desc": rule.get("desc"),
            })
            continue
        findings.extend(fn(rule, ctx))
    return findings, llm_rules, gaps


def apply_fixes(text, findings):
    """删除标记为 fixable 的行（安全项），返回 (新文本, 删除行数)。"""
    targets = sorted({f["line"] for f in findings if f.get("fixable") and f.get("line")},
                     reverse=True)
    lines = text.split("\n")
    removed = 0
    for ln in targets:
        if 1 <= ln <= len(lines):
            lines[ln - 1] = None
            removed += 1
    return "\n".join(l for l in lines if l is not None), removed


def main():
    ap = argparse.ArgumentParser(description="validate-article 固定解释器")
    ap.add_argument("file", help="待校验的 markdown 文件")
    ap.add_argument("--ruleset", required=True, help="规则集 JSON 路径")
    ap.add_argument("--fix", action="store_true", help="执行安全项修复")
    ap.add_argument("--format", choices=["json", "text"], default="json")
    args = ap.parse_args()

    path = Path(args.file)
    if not path.is_file():
        print(json.dumps({"error": f"文件不存在: {args.file}"}, ensure_ascii=False))
        sys.exit(2)

    ruleset = json.loads(Path(args.ruleset).read_text(encoding="utf-8-sig"))
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")

    findings, llm_rules, gaps = run(ruleset, path, raw, text)

    fixed = []
    if args.fix:
        new_text, removed = apply_fixes(text, findings)
        if removed:
            path.write_text(new_text, encoding="utf-8")
            fixed.append(f"已删除 {removed} 处可修复项")
            findings = [f for f in findings if not f.get("fixable")]

    errors = sum(1 for f in findings if f["severity"] == "error")
    warnings = sum(1 for f in findings if f["severity"] == "warning")
    result = {
        "file": str(path),
        "schema_version": ruleset.get("schema_version"),
        "findings": findings,
        "llm_rules": llm_rules,
        "coverage_gaps": gaps,
        "fixed": fixed,
        "summary": {"errors": errors, "warnings": warnings},
    }

    if args.format == "text":
        print(f"文件: {path}")
        print(f"错误 {errors}  警告 {warnings}  待判 {len(llm_rules)}  缺口 {len(gaps)}")
        for f in findings:
            loc = f"第 {f['line']} 行" if f["line"] else "—"
            print(f"  [{f['severity']}] {loc} {f['rule']}: {f['issue']}")
        for g in gaps:
            print(f"  [gap] {g['id']}: {g['reason']}")
        for n in fixed:
            print(f"  [fixed] {n}")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))

    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
