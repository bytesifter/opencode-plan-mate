#!/usr/bin/env python3
"""skill_cache —— 规范驱动 skill 的通用 JIT 缓存（共享模块，单一权威）

按「适用规范内容 + 抽取器版本 + 指令集版本」计算 cache key，并提供 get/put
读写派生规则集。与具体 skill 无关：
  - skill 名缺省取本文件所在目录名（部署后即 skill 名），可用 --skill 覆盖
  - 缓存根 = $XDG_CACHE_HOME ?? ~/.cache  +  /opencode/skill-cache/<skill>/

用法:
    python cache.py key <规范文件...>
    python cache.py get <规范文件...>          # 命中: 打印路径, exit 0；未命中: 打印 MISS, exit 1
    python cache.py put <规范文件...> <ruleset.json>

版本来源（自动）:
    extractor_version = sha256(<skill目录>/SKILL.md)
    isa_version       = <skill目录>/engine.py 中的 ISA_VERSION 字面量

本模块由各 skill 的 sync.sh 从 skills/_shared/ 拷入部署目录后使用；
纯标准库实现，跨平台（Linux / macOS / Windows）。
"""

import os
import re
import sys
import json
import hashlib
import argparse
from pathlib import Path

RE_ISA = re.compile(r'ISA_VERSION\s*=\s*["\']([^"\']+)["\']')


def skill_name_from(module_file) -> str:
    """skill 名缺省取本文件所在目录名。"""
    return Path(module_file).parent.name


def cache_root() -> Path:
    """缓存根：$XDG_CACHE_HOME ?? ~/.cache，再加 opencode/skill-cache。"""
    xdg = os.environ.get("XDG_CACHE_HOME")
    base = Path(xdg) if xdg else Path.home() / ".cache"
    return base / "opencode" / "skill-cache"


def cache_dir(skill: str) -> Path:
    return cache_root() / skill


def entry_path(skill: str, key: str) -> Path:
    return cache_dir(skill) / f"{key}.json"


def detect_extractor_version(skill_dir) -> str:
    """抽取器版本 = SKILL.md 内容哈希（不存在则空串）。"""
    p = Path(skill_dir) / "SKILL.md"
    if not p.is_file():
        return ""
    return hashlib.sha256(p.read_bytes()).hexdigest()


def detect_isa_version(skill_dir) -> str:
    """指令集版本 = 同目录 engine.py 的 ISA_VERSION 字面量（不存在则空串）。"""
    p = Path(skill_dir) / "engine.py"
    if not p.is_file():
        return ""
    m = RE_ISA.search(p.read_text(encoding="utf-8-sig", errors="replace"))
    return m.group(1) if m else ""


def compute_key(skill_dir, norm_paths) -> str:
    """key = sha256(各规范文件内容 + extractor_version + isa_version)。"""
    h = hashlib.sha256()
    for p in sorted((Path(x) for x in norm_paths), key=lambda x: x.name):
        h.update(p.name.encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    h.update(detect_extractor_version(skill_dir).encode("utf-8"))
    h.update(b"\0")
    h.update(detect_isa_version(skill_dir).encode("utf-8"))
    return h.hexdigest()


def get(skill: str, key: str):
    """命中返回条目字节；未命中或损坏返回 None（损坏视为未命中）。"""
    p = entry_path(skill, key)
    if not p.is_file():
        return None
    try:
        data = p.read_bytes()
        json.loads(data.decode("utf-8-sig"))
        return data
    except Exception:
        return None


def put(skill: str, key: str, data: bytes) -> Path:
    """原子写入缓存条目，返回最终路径。"""
    d = cache_dir(skill)
    d.mkdir(parents=True, exist_ok=True)
    final = d / f"{key}.json"
    tmp = d / f"{key}.json.tmp"
    tmp.write_bytes(data)
    os.replace(tmp, final)
    return final


def main():
    ap = argparse.ArgumentParser(description="规范驱动 skill 的通用 JIT 缓存")
    ap.add_argument("command", choices=["key", "get", "put"])
    ap.add_argument("args", nargs="+", help="规范文件...（put 时最后一个是 ruleset.json）")
    ap.add_argument("--skill", help="skill 名（缺省取本文件所在目录名）")
    a = ap.parse_args()

    module_file = Path(__file__).resolve()
    skill_dir = module_file.parent
    skill = a.skill or skill_name_from(module_file)

    if a.command == "put":
        if len(a.args) < 2:
            print("用法: cache.py put <规范文件...> <ruleset.json>", file=sys.stderr)
            sys.exit(2)
        norm_paths, ruleset = a.args[:-1], Path(a.args[-1])
    else:
        norm_paths, ruleset = a.args, None

    missing = [p for p in norm_paths if not Path(p).is_file()]
    if missing:
        print(f"规范文件不存在: {', '.join(missing)}", file=sys.stderr)
        sys.exit(2)

    key = compute_key(skill_dir, norm_paths)

    if a.command == "key":
        print(key)
        return

    if a.command == "put":
        if not ruleset.is_file():
            print(f"规则集不存在: {ruleset}", file=sys.stderr)
            sys.exit(2)
        print(put(skill, key, ruleset.read_bytes()))
        return

    # get
    data = get(skill, key)
    if data is None:
        print("MISS")
        sys.exit(1)
    print(entry_path(skill, key))


if __name__ == "__main__":
    main()
