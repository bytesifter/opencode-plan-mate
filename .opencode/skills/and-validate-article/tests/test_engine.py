#!/usr/bin/env python3
"""engine.py 单元测试（标准库 unittest）"""

import sys
import unittest
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine  # noqa: E402


def rule(rid, primitive, params=None, severity="error", dimension="规范性",
         norm="规范 §x", fix=None, desc=None):
    return {
        "id": rid, "mode": "machine", "primitive": primitive,
        "params": params or {}, "severity": severity, "dimension": dimension,
        "norm": norm, "fix": fix, "desc": desc or rid,
    }


def run(rules, text, filename="a-article.md", raw=None):
    rs = {"schema_version": 1, "source_hash": "x", "rules": rules, "coverage_gaps": []}
    raw = raw if raw is not None else text.encode("utf-8")
    return engine.run(rs, Path(filename), raw, text)


class RegexLineScanTest(unittest.TestCase):
    def test_outside_fence_only(self):
        text = "段落\n\n---\n\n```\n---\n```\n"
        r = rule("r", "regex_line_scan",
                 {"pattern": engine.RE_THEMATIC.pattern, "scope": "body",
                  "exclude_setext": True, "desc": "禁用分割线"})
        findings, _, _ = run([r], text)
        self.assertEqual([f["line"] for f in findings], [3])

    def test_setext_excluded(self):
        text = "标题\n---\n正文\n"
        r = rule("r", "regex_line_scan",
                 {"pattern": engine.RE_THEMATIC.pattern, "scope": "body",
                  "exclude_setext": True, "desc": "禁用分割线"})
        findings, _, _ = run([r], text)
        self.assertEqual(findings, [])


class HeadingSequenceTest(unittest.TestCase):
    def test_jump_detected(self):
        text = "# 标题\n\n### 跳级\n"
        r = rule("h", "heading_sequence", {"max_delta": 1, "desc": "标题跳级"})
        findings, _, _ = run([r], text)
        self.assertEqual([f["line"] for f in findings], [3])

    def test_no_jump(self):
        text = "# 标题\n\n## 二级\n\n### 三级\n"
        r = rule("h", "heading_sequence", {"max_delta": 1, "desc": "标题跳级"})
        findings, _, _ = run([r], text)
        self.assertEqual(findings, [])


class CodeFenceInfoTest(unittest.TestCase):
    def test_missing_lang(self):
        text = "```\ncode\n```\n\n```python\ncode\n```\n"
        r = rule("c", "code_fence_info", {"required": True, "desc": "代码块须标语言"})
        findings, _, _ = run([r], text)
        self.assertEqual([f["line"] for f in findings], [1])


class FilenamePatternTest(unittest.TestCase):
    def test_bad_filename(self):
        r = rule("f", "filename_pattern",
                 {"pattern": engine.RE_KEBAB.pattern, "desc": "文件名 kebab-case"})
        findings, _, _ = run([r], "x", filename="Bad Name.md")
        self.assertEqual(len(findings), 1)

    def test_good_filename(self):
        r = rule("f", "filename_pattern",
                 {"pattern": engine.RE_KEBAB.pattern, "desc": "文件名 kebab-case"})
        findings, _, _ = run([r], "x", filename="good-name.md")
        self.assertEqual(findings, [])


class BytesFactTest(unittest.TestCase):
    def test_encoding_bad(self):
        r = rule("b", "bytes_fact", {"kind": "encoding", "expected": "utf-8",
                                     "desc": "必须 UTF-8"})
        findings, _, _ = run([r], "x", raw=b"\xff\xfe\x00bad")
        self.assertEqual(len(findings), 1)

    def test_eol_crlf(self):
        r = rule("b", "bytes_fact", {"kind": "eol", "expected": "lf", "desc": "须 LF"})
        findings, _, _ = run([r], "a\r\nb\n", raw=b"a\r\nb\n")
        self.assertEqual(len(findings), 1)

    def test_eol_lf_ok(self):
        r = rule("b", "bytes_fact", {"kind": "eol", "expected": "lf", "desc": "须 LF"})
        findings, _, _ = run([r], "a\nb\n", raw=b"a\nb\n")
        self.assertEqual(findings, [])


class WordlistMatchTest(unittest.TestCase):
    def test_clickbait_h1(self):
        text = "# 震惊！这个方法\n\n正文\n"
        r = rule("w", "wordlist_match",
                 {"scope": "heading", "level": 1, "words": ["震惊", "不看后悔"],
                  "desc": "标题党"})
        findings, _, _ = run([r], text)
        self.assertEqual([f["line"] for f in findings], [1])


class ParagraphStatTest(unittest.TestCase):
    def test_no_blank(self):
        text = "段落一。内容。\n段落二。内容。\n"
        r = rule("p", "paragraph_stat", {"kind": "no_blank", "min_len": 10,
                                         "desc": "无空行分段"})
        findings, _, _ = run([r], text)
        self.assertEqual(len(findings), 1)

    def test_no_punct(self):
        text = "这是一段很长很长的没有任何标点的文字内容用于测试\n\n"
        r = rule("p", "paragraph_stat", {"kind": "no_punct", "min_len": 10,
                                         "desc": "无标点"})
        findings, _, _ = run([r], text)
        self.assertEqual(len(findings), 1)


class ModeAndFallbackTest(unittest.TestCase):
    def test_llm_rule_passthrough(self):
        r = {"id": "sem", "mode": "llm", "severity": "info",
             "dimension": "完整性", "norm": "规范 §y", "desc": "语义规则"}
        findings, llm, gaps = run([r], "x")
        self.assertEqual(findings, [])
        self.assertEqual([x["id"] for x in llm], ["sem"])
        self.assertEqual(gaps, [])

    def test_unknown_primitive_falls_back(self):
        r = rule("u", "not_a_primitive", {"desc": "无法映射"})
        findings, llm, gaps = run([r], "x")
        self.assertEqual(findings, [])
        self.assertEqual([x["id"] for x in llm], ["u"])
        self.assertEqual([g["id"] for g in gaps], ["u"])


class FixTest(unittest.TestCase):
    def test_delete_line(self):
        text = "段落\n\n---\n\n结束\n"
        r = rule("r", "regex_line_scan",
                 {"pattern": engine.RE_THEMATIC.pattern, "scope": "body",
                  "exclude_setext": True, "desc": "禁用分割线"}, fix="delete_line")
        rs = {"schema_version": 1, "source_hash": "x", "rules": [r], "coverage_gaps": []}
        findings, _, _ = engine.run(rs, Path("a.md"), text.encode("utf-8"), text)
        new_text, removed = engine.apply_fixes(text, findings)
        self.assertEqual(removed, 1)
        self.assertNotIn("---", new_text.split("\n"))


if __name__ == "__main__":
    unittest.main()
