# 系统内测试证据 master / opencode-plan-mate

- 时间：2026-10-25 09:24:33
- 层：systest
- 应用：opencode-plan-mate（整项目退化单位）
- 分支：master
- 档位（profile）：unit-only
- 代码指纹：5239c1aa0ecf
- 标准版本：integration-standards.md 2.3

## 摘要

| 项 | 值 |
|----|----|
| 用例数 | — |
| 通过 | — |
| 失败 | — |
| 错误 | — |
| 跳过 | — |
| 未执行 | — |
| 结论 | not_executed |
| 原因 | profile unit-only（本轮仅激活 unit）；且项目无标准部署入口 `deploy/deploy.sh`、无当前机器声明 `.opencode/machines/active`（就绪三态①未声明） |

## 用例数变化

- 相对上一轮：不适用（未执行）

## 明细（unit-only 档可省略）

| 用例 | 结果 | 备注 |
|------|------|------|
| — | 未执行 | 见上「原因」 |

## 关键风险

- 系统内层缺失意味着「应用作为整体可用」未验证；补齐需先提供标准入口 `deploy/deploy.sh` 与 `.opencode/machines/active`。
