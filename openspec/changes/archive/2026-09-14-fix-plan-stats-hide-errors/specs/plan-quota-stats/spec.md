## MODIFIED Requirements

### Requirement: ASCII 表 + percent 柱渲染

`plan_stats` 工具返回 SHALL 为 ASCII 表格/柱状图文本：每行一个账号，展示 session / weekly / monthly 三个窗口的百分比柱状图与重置时间。查询失败（error）的账号行 SHALL 标注错误信息，且错误行 SHALL NOT 被"暂无统计数据"吞掉。仅当所有账号均未订阅且无错误，或账号列表为空时，工具 SHALL 返回"暂无统计数据"。

#### Scenario: 有数据返回图表

- **WHEN** 至少一个账号查询到配额
- **THEN** 返回文本 SHALL 每行包含一个账号、三个窗口的 percent 柱与 reset_at

#### Scenario: 全部查询失败显示错误行

- **WHEN** 所有账号均无配额数据且至少一个账号存在 error（如未登录 / SSO 失效 / arkcli 缺失）
- **THEN** 工具 SHALL 渲染表头并为每个账号输出错误行或未订阅行，SHALL NOT 直接返回"暂无统计数据"

#### Scenario: 无数据提示

- **WHEN** 所有账号均未订阅且无任何错误，或账号列表为空
- **THEN** 工具 SHALL 返回"暂无统计数据"
