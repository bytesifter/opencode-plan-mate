---
name: and-validate-article
version: 0.3.0
description: "技术文章校验（多源独立评审）：默认依项目本地规范校验（运行时经项目根 AGENTS.md 抽取规则集），可选按配置注册的外部平台标准（CSDN 等网页）独立评审打分。每源独立报告、不混合分数。当用户要检查/校验/审查一篇技术文章（markdown）质量、发布前自检、或按指定平台标准做发布评审时使用。反触发：非 markdown 文档、纯代码文件、配置文件不校验。"
metadata:
  requires:
    bins: [python3]
  cliHelp: "python3 engine.py <file.md> --ruleset <ruleset.json>"
---

# and-validate-article 技术文章校验（多源独立评审）

本 skill 校验一篇技术文章（markdown）的发布就绪度。**判定标准不在本文件内**：所有判定来源——本地规范或外部平台标准——都在运行时抽取（**规范驱动**）。默认仅基于项目本地规范校验（findings + 红线 hard-fail，无外部评分）；可按配置注册的外部平台标准做独立评审打分。

**本 skill 目录**：即本 `SKILL.md` 所在目录。`engine.py`、`sources.yaml` 与 `references/` 均在此目录下。调用 `engine.py` 时须用本目录的绝对路径（运行时工作目录是用户项目，不是 skill 目录）。

## 源模型（权威源：本目录 sources.yaml）

```
  sources.yaml（skill 全局注册表，随 skill 部署）
    norm        type: local   项目本地规范（经项目根 AGENTS.md 运行时定位）
    csdn        type: url     CSDN《标注专家质量判定标准》——含权重/分级/扣分表，可打分
    csdn-rules  type: url     CSDN《社区内容创作规范》——发布红线清单，无评分
    ...（按需增删；JS 渲染页如掘金小册 webfetch 抓不到正文则留注释不注册）
```

- **默认源** = `norm`；`--sources <names>` 选择子集；`--sources all` = 全平台审计（norm + 全部已注册 url 源）
- 每个选中源**独立**执行完整校验、独立出报告；多源运行**不混合分数、不汇总**
- 评分**随源而定**：仅当源文本自身定义了权重/分级/扣分规则时才打分（见 Step 1 的 `scoring` 元数据）

## 工作流

### Step 0：源选择（门禁）

1. 读本目录 `sources.yaml`，确定所选源：用户显式 `--sources <names>`；未指定默认 `norm`；`all` = norm + 全部 url 源
2. **本地源（norm）**：读项目根 `AGENTS.md`（唯一入口），定位其指向的规范体系，判定项目类型（配置/文档/程序），按路由表确定适用规范集；不假设任何具体规范文件名
3. **URL 源**：对每个选中 url 源用 `webfetch` 抓取源文本；抓取失败或解析不到正文 → 该源报告标注「抓取/抽取失败」，**不阻塞其他源**
4. **规范缺位**（本地源定位不到适用规范）：声明缺位并提示用户，**不臆断、不退回内置规则**
5. 待校验文章路径：以用户显式给定为主；未指定时，仅当当前项目确实存在 `articles/` 或 `docs/` 目录时作可选兜底扫描；两者皆无则提示用户提供路径

### Step 1：规则集抽取 + 缓存（每源一份）

对每个选中源独立执行：

- **本地源**：适用规范文件直接作为抽取输入
- **URL 源**：把 Step 0 抓取的文本写入缓存根下临时文件（`<缓存根>/fetched-<源名>.txt`，缓存根见下），作为抽取输入
- 先查缓存，再按需抽取：

```bash
# 命中: 打印缓存 ruleset 路径, exit 0；未命中: 打印 MISS, exit 1
python3 <本skill目录>/cache.py get <抽取输入文件...>
# 未命中时：把规则集抽到临时文件并写入缓存，用其返回路径
python3 <本skill目录>/cache.py put <抽取输入文件...> <tmp-ruleset.json>
```

规则集 schema（schema_version 2，抽取产物），每条规则**必引「规范依据（文件 + 节）」**：

```json
{
  "schema_version": 2,
  "source": {"type": "local_norms" | "url", "location": "<规范体系描述 | 源 URL>"},
  "source_hash": "<抽取输入内容哈希>",
  "scoring": {
    "dimensions": [{"name": "<维度名>", "weight": <权重>}],
    "grades": [{"label": "<分级名>", "min": <阈值>}],
    "deductions": [{"issue": "<问题类型>", "dimension": "<维度名>", "points": <扣分>}]
  },
  "rules": [
    {"id": "no-horizontal-rule", "mode": "machine", "primitive": "regex_line_scan",
     "params": {"pattern": "...", "scope": "body", "exclude_setext": true},
     "severity": "error", "dimension": "规范性", "norm": "<规范文件+节>",
     "fix": "delete_line", "desc": "正文禁用水平分割线"},
    {"id": "fact-discipline", "mode": "llm", "severity": "info",
     "dimension": "完整性", "norm": "<规范文件+节>", "desc": "事实纪律三类陈述"}
  ],
  "coverage_gaps": []
}
```

- **`scoring` 为可选**：仅当源文本自身定义了评分元数据（维度权重 / 分级阈值 / 扣分规则）才填充；本地规范源不填 → 该源不输出分数。`scoring` 的维度/分级/扣分**全部来自源文本抽取**，skill 不内置、不臆造
- `dimension` 取值随源：本地规范按规范自身结构（格式 / 内容质量 / 事实纪律…），外部源按源文本定义，**不强制映射任何固定四维**
- `mode=machine`：须映射到下方**原语目录**中的 `primitive` + `params`
- `mode=llm`：语义规则，作为 AI 判定清单项（携带规范依据指针）
- **回落**：无法映射到任何原语的规则，标 `mode=llm` 并追加到 `coverage_gaps`（`{id, reason, norm}`），报告显式列出，**不静默丢弃**
- **缓存说明**：key = sha256(各抽取输入文件内容 + `SKILL.md` 哈希 + 同目录 `engine.py` 的 `ISA_VERSION`)，由 `cache.py` 计算，LLM 无需手工算；内容或抽取器/原语版本一变自动重抽。缓存根为 `~/.cache/opencode/skill-cache/and-validate-article/`（`$XDG_CACHE_HOME` 优先），不写 skill 目录

### Step 2：L1 格式合规（确定性，机械执行）

运行本目录下的 `engine.py`（**用绝对路径**），传入规则集：

```bash
python3 <本skill目录>/engine.py "<文章路径>" --ruleset "<ruleset.json路径>" --format json
```

- `engine.py` 只执行 `mode=machine` 的机械规则；解析输出 `findings`（含 `dimension/rule/severity/issue/line/norm/fixable`）与 `coverage_gaps`
- 用户要求修复且确认：加 `--fix` 重跑（仅规则集中标记为可修的安全项；需猜测项只报告不修）

### Step 3：L2 内部质量（AI 判断）

依据规则集中 `dimension` 为内部质量类的规则（`mode=llm` 项 + Step 1 抽取到的结构/事实纪律要求）逐项评估。子维度与判定来源随抽取结果，不预设固定映射：

输出每项：`子维度 / 判断(达标/部分/缺失) / 依据(引用文章具体位置)`。给依据而非纯打分，允许人工覆核。

### Step 4：L3 事实核查（AI + webfetch）

依据规则集中事实核查类规则，从文章抽取可验证的技术断言，对照权威外部源核对：

1. 对可预测 URL 的断言用 `webfetch` 抓权威源（库/版本 → PyPI / GitHub releases；仓库/链接 → GitHub 仓库页；模块/签名 → 官方文档或源码）
2. 无法通过可预测 URL 核对的断言标「未验证」，**绝不**用 AI 自身知识臆断对错
3. 主观类比（如「类似 Spring Boot」）归 L2 可读性，不核查
4. 每条输出：`断言 / 核对源(URL+抓取时间) / 结论(正确/错误/未验证) / 依据`

注意：opencode 当前只有 `webfetch`（抓指定 URL）无 web search，L3 覆盖率受限于「可预测 URL」的断言；诚实标注盲区优于臆断。

### Step 5：独立报告（每源一份）

对每个选中源输出一份独立报告，**不混合分数、不汇总**：

```
┌─ 校验报告（源: <源名>）──────────────────────┐
│ 文章: <路径>                                │
│ 源: <源名>  来源版本: <标题/日期 或 抓取时间>    │
│ 类型: <识别出的文章类型>                      │
├─ findings（按抽取规则集的 dimension 分组）─────┤
│ <维度>                                      │
│   - [error]   第 42 行 ...                   │
│   - 部分: <依据>                             │
├─ 红线（hard-fail，命中即按源语义不可发布/一票否决）│
├─ 评分（仅规则集含 scoring 元数据时）────────────┤
│ 按 <源名> 权重: 总分 XX   分级: <按源定义>      │
│   - 各维度得分依据与扣分项（按源扣分规则）        │
├─ 覆盖缺口 ────────────────────────────────────┤
│ (无法编译为原语的规则，已回落 AI 判定)           │
└─────────────────────────────────────────────┘
```

- **默认 norm 源**：规则集无 `scoring` 元数据 → 报告不含「评分」段
- **外部源**：仅当该源定义了评分元数据才打分；分级含义按源自身定义，**不附加「可直接发布」等非源语义**
- 多源运行：逐源输出独立报告

## 原语目录（ISA，engine.py 支持）

| 原语 | 参数 | 覆盖（示例） |
|------|------|-------------|
| `regex_line_scan` | `pattern`, `scope`(all/outside_fence/body/front_matter), `exclude_setext?` | 正文禁 `---` |
| `heading_sequence` | `max_delta` | 标题跳级 |
| `code_fence_info` | `required` | 代码块须标语言 |
| `filename_pattern` | `pattern` | 文件名 kebab-case |
| `bytes_fact` | `kind`(encoding/bom/eol), `expected` | UTF-8 / LF |
| `wordlist_match` | `scope`(heading/body), `level?`, `words[]` | 标题党词表 |
| `paragraph_stat` | `kind`(no_blank/no_punct), `min_len` | 排版混乱 |
| `fix` 动作 | `delete_line` | 安全项自动修 |

规范出现现有原语表达不了的机械规则时：回落 `mode=llm` + 记 `coverage_gaps`（见 Step 1），由人工决定是否补原语。

## 修复模式

仅 L1 规则集中标记 `fix` 的安全项可自动修（`engine.py --fix`）。需猜测项只报告。L2/L3 发现**永远只报告**，绝不自动改写文章内容。

## 输出语言

报告语言遵循适用规范中的语言政策条款（运行时抽取）。未抽取到语言政策时默认简体中文，技术术语（markdown/ASCII/GitHub 等）与代码标识符保留英文。
