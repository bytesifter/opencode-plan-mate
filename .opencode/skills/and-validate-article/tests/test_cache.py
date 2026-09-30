#!/usr/bin/env python3
"""skill_cache.py 单元测试（标准库 unittest）"""

import os
import sys
import json
import shutil
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "_shared"))
import skill_cache  # noqa: E402


class CacheTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cachetest-"))
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        os.environ["XDG_CACHE_HOME"] = str(self.tmp / "cache")

    def tearDown(self):
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make_skill(self, skill_md="v1", isa="1", name="validate-article"):
        d = self.tmp / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(skill_md, encoding="utf-8")
        (d / "engine.py").write_text(f'ISA_VERSION = "{isa}"\n', encoding="utf-8")
        return d

    def make_norms(self):
        a = self.tmp / "norm-a.md"
        b = self.tmp / "norm-b.md"
        a.write_text("rule a", encoding="utf-8")
        b.write_text("rule b", encoding="utf-8")
        return [a, b]


class KeyTest(CacheTestCase):
    def test_key_stable(self):
        d = self.make_skill()
        norms = self.make_norms()
        self.assertEqual(skill_cache.compute_key(d, norms),
                         skill_cache.compute_key(d, norms))

    def test_key_changes_with_norm_content(self):
        d = self.make_skill()
        norms = self.make_norms()
        k1 = skill_cache.compute_key(d, norms)
        norms[0].write_text("rule a changed", encoding="utf-8")
        self.assertNotEqual(k1, skill_cache.compute_key(d, norms))

    def test_key_changes_with_skill_md(self):
        norms = self.make_norms()
        k1 = skill_cache.compute_key(self.make_skill(skill_md="v1"), norms)
        k2 = skill_cache.compute_key(self.make_skill(skill_md="v2"), norms)
        self.assertNotEqual(k1, k2)

    def test_key_changes_with_isa_version(self):
        norms = self.make_norms()
        k1 = skill_cache.compute_key(self.make_skill(isa="1"), norms)
        k2 = skill_cache.compute_key(self.make_skill(isa="2"), norms)
        self.assertNotEqual(k1, k2)

    def test_detect_versions(self):
        d = self.make_skill(skill_md="hello", isa="3")
        self.assertEqual(skill_cache.detect_isa_version(d), "3")
        self.assertTrue(skill_cache.detect_extractor_version(d))


class StoreTest(CacheTestCase):
    def test_put_get_roundtrip(self):
        d = self.make_skill()
        norms = self.make_norms()
        key = skill_cache.compute_key(d, norms)
        data = json.dumps({"rules": []}).encode("utf-8")
        path = skill_cache.put("validate-article", key, data)
        self.assertTrue(path.is_file())
        self.assertEqual(skill_cache.get("validate-article", key), data)

    def test_miss_when_absent(self):
        self.assertIsNone(skill_cache.get("validate-article", "deadbeef"))

    def test_corrupt_entry_is_miss(self):
        d = self.make_skill()
        key = skill_cache.compute_key(d, self.make_norms())
        path = skill_cache.entry_path("validate-article", key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{ not json", encoding="utf-8")
        self.assertIsNone(skill_cache.get("validate-article", key))


class PathTest(CacheTestCase):
    def test_skill_name_from_module_file(self):
        p = Path("/x/skills/validate-article/cache.py")
        self.assertEqual(skill_cache.skill_name_from(p), "validate-article")

    def test_cache_dir_under_skill_cache(self):
        d = skill_cache.cache_dir("validate-article")
        self.assertEqual(d.name, "validate-article")
        self.assertEqual(d.parent.name, "skill-cache")
        self.assertEqual(d.parent.parent.name, "opencode")
        self.assertEqual(d.parent.parent.parent, self.tmp / "cache")


if __name__ == "__main__":
    unittest.main()
