# 单元测试证据 master / opencode-plan-mate

- 时间：2026-10-25 09:24:33
- 层：unit
- 应用：opencode-plan-mate（项目无部署域，按 `norms/AGENTS-test.md` §1.1 退化规则整项目视为一个单位）
- 分支：master
- 档位（profile）：unit-only
- 代码指纹：5239c1aa0ecf（`src/` + `tests/` 共 26 个文件，按路径排序 + 内容 sha256 聚合；排除证据目录自身）
- 标准版本：integration-standards.md 2.3

## 摘要

| 项 | 值 |
|----|----|
| 用例数 | 233 |
| 通过 | 233 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0（无理由跳过 0） |
| 未执行 | 0 |
| 结论 | pass |
| 原因 | — |

## 用例数变化

- 相对上一轮：首轮（`dev-notes/test-reports/master/` 此前无证据）

## 明细（unit-only 档按摘要层记录）

| 用例 | 结果 | 备注 |
|------|------|------|
| `bun test`（12 个测试文件，233 用例） | 通过 | 执行命令：`bun test`；退出码 0；输出中 `error: boom` 为负向用例的预期日志，非失败 |

## 关键风险

- 单元层全部使用替身，不覆盖目标环境真实依赖；本项目当前无标准部署入口与环境声明，系统内 / 端到端层未激活（记 `not_executed`）。
