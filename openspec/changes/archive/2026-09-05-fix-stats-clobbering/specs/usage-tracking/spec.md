## MODIFIED Requirements

### Requirement: 按天累计请求数与 token

插件 SHALL 通过 `event` hook 监听 `message.updated` 事件，按天、按 provider 累计请求数与 token 消耗。统计 SHALL 在内存对象上累积，定时器每 60 秒将增量追加刷盘一次；进程退出时 SHALL 兜底刷盘。

token 归因到实际服务的 provider（而非 opencode 配置的 provider），通过 fetch-patch 层建立的 sessionID-provider 关联映射实现。当关联映射中无记录时（如全熔断 passthrough），SHALL fallback 到 `info.providerID`。

去重逻辑 SHALL 以 token 快照变化检测为基础：同一 `info.id` 的事件，仅当 token 快照与上次记录的不同时才累加（即新 step 的 token）；相同 token 快照的重复事件（如 cleanup re-emission）SHALL 跳过。

#### Scenario: 多步对话每步 token 均累加

- **WHEN** 同一 `info.id` 的 `message.updated` 事件依次到达：第一步 `finish="tool-calls"` tokens={in:1000}，第二步 `finish="stop"` tokens={in:3000}
- **THEN** 插件 SHALL 累加两步的 token（总计 in=4000），`req` SHALL 为 2
- **AND** 第一步的 token SHALL 归因到第一步 fetch 时关联的 provider，第二步的 token SHALL 归因到第二步 fetch 时关联的 provider

#### Scenario: 相同 token 快照的重复事件不重复累加

- **WHEN** 同一 `info.id` 的 `message.updated` 事件到达，且其 token 快照与上次记录的完全相同
- **THEN** 插件 SHALL 跳过该事件，不累加 token，不增加 `req`

#### Scenario: token 归因到实际服务的 provider

- **WHEN** `message.updated` 事件的 `info.sessionID` 在关联映射中存在
- **THEN** 插件 SHALL 将 token 累加到该 sessionID 对应的 provider 名下

#### Scenario: passthrough 时 fallback 到配置 provider

- **WHEN** `message.updated` 事件的 `info.sessionID` 在关联映射中不存在（如全熔断 passthrough）
- **THEN** 插件 SHALL 将 token 累加到 `info.providerID` 名下

#### Scenario: 缺 id 或 tokens 的事件忽略

- **WHEN** `message.updated` 事件的 `info` 缺 `id` 字段或缺 `tokens` 字段
- **THEN** 插件 SHALL 忽略该事件

#### Scenario: 事件触发只改内存

- **WHEN** 统计事件发生（含 token 累加）
- **THEN** 插件 SHALL 只更新内存对象，SHALL NOT 立即写磁盘

#### Scenario: 进程退出兜底刷盘

- **WHEN** 进程收到 `beforeExit` / `SIGINT` / `SIGTERM`
- **THEN** 插件 SHALL 最后刷盘一次，避免丢失最近统计

### Requirement: 内存累积与定时刷盘

插件 SHALL 在内存对象上累积统计，定时器每 60 秒将自上次刷盘以来的**增量**追加写入当天的 JSONL 文件一次。进程退出时 SHALL 兜底刷盘一次。追加写入 SHALL 以单次 append 完成，多个进程并发追加 SHALL 不互相覆盖、不产生交错行。

#### Scenario: 事件触发只改内存

- **WHEN** 统计事件发生
- **THEN** 插件 SHALL 只更新内存对象，不立即写磁盘

#### Scenario: 定时器触发刷盘

- **WHEN** 距上次刷盘已满 60 秒
- **THEN** 插件 SHALL 将自上次刷盘以来的增量记录追加写入当天的 JSONL 文件，追加完成后 SHALL 清空未落盘增量

#### Scenario: 重复刷盘不重复追加

- **WHEN** 连续两次 flush 之间没有新的统计事件（无新增增量）
- **THEN** 插件 SHALL NOT 追加任何记录

#### Scenario: 进程退出刷盘

- **WHEN** 进程收到 `beforeExit`/`SIGINT`/`SIGTERM`
- **THEN** 插件 SHALL 最后刷盘一次，避免丢失最近统计

### Requirement: JSON 文件存储结构

统计落盘 SHALL 为**追加式 JSONL**，按日一个文件，位于 `statsDir` 目录（默认 `~/.local/share/opencode/round-robin-stats/`，可由 `statsDir` 配置覆盖），文件名 SHALL 为 `YYYY-MM-DD.jsonl`。每行 SHALL 为一条自包含的增量记录：`{ day, provider, req, in, out, reasoning, cacheRead, cacheWrite, cost }`，其中各数值为该条记录的增量（`req` 可为同一 flush 窗口内多条请求合并的 >1 值）。插件 SHALL NOT 加载旧的单文件 `round-robin-stats.json`。

#### Scenario: 存储结构

- **WHEN** 读取某个日期的统计文件
- **THEN** 内容形如一行行增量记录：`{"day":"2026-07-25","provider":"account-a","req":1,"in":100,"out":50,"reasoning":10,"cacheRead":0,"cacheWrite":0,"cost":0}`

#### Scenario: 跨进程追加不互相覆盖

- **WHEN** 多个 opencode 进程各自对同一日期文件追加增量记录
- **THEN** 所有记录 SHALL 均完整保留，无覆盖、无交错

#### Scenario: 旧单文件 JSON 不兼容

- **WHEN** 插件启动时存在旧的单文件 `round-robin-stats.json`
- **THEN** 插件 SHALL NOT 读取该文件，从空统计开始

### Requirement: 图表查询工具

插件 SHALL 注册名为 `roundrobin_stats` 的工具，执行时返回近 N 天（默认 7）的 ASCII 柱状图，按 provider 分列展示请求数与 token 消耗。工具参数 SHALL 支持可选 `days` 指定天数。工具数据源 SHALL 为磁盘上聚合所有进程追加的 JSONL 记录所得结果（先触发本进程 flush 再聚合），SHALL NOT 仅展示本进程内存统计。

#### Scenario: 调用工具返回 per-provider 图表

- **WHEN** 调用 `roundrobin_stats` 工具（无参数）
- **THEN** 工具 SHALL 返回近 7 天的 ASCII 柱状图字符串，按 provider 分列展示每 provider 的请求数与 token

#### Scenario: 指定天数

- **WHEN** 调用 `roundrobin_stats` 工具且参数 `days` 为 30
- **THEN** 工具 SHALL 返回近 30 天的图表

#### Scenario: 跨进程数据可见

- **WHEN** 多个进程各自记录了不同 provider 的用量
- **THEN** 工具 SHALL 返回聚合后包含所有 provider 的图表

#### Scenario: 无数据

- **WHEN** 统计目录不存在或为空
- **THEN** 工具 SHALL 返回提示"暂无统计数据"

### Requirement: 历史数据不回溯

本 change 不提供历史统计数据迁移能力。旧的单文件 `round-robin-stats.json` SHALL NOT 被读取或迁移；历史数据已因多进程并发覆盖而不完整，由用户自行决定是否备份旧文件。

#### Scenario: 旧单文件 JSON 不被读取

- **WHEN** 插件启动时存在旧的单文件 `round-robin-stats.json`
- **THEN** 插件 SHALL NOT 读取该文件，SHALL 从空的增量记录开始统计

## ADDED Requirements

### Requirement: 聚合读取

插件 SHALL 提供按日期聚合 JSONL 增量记录为 `StatsStore`（day → provider → 累计值）的能力，供图表工具使用。聚合 SHALL 对同一 `(day, provider)` 的所有增量记录逐字段求和。读取时遇到无法解析的行 SHALL 跳过，SHALL NOT 中断聚合。

#### Scenario: 多进程增量求和

- **WHEN** 同一日期文件中有多条来自不同进程的 `(day, provider)` 增量记录
- **THEN** 聚合结果 SHALL 为该 provider 当日所有增量的逐字段求和

#### Scenario: 损坏行跳过

- **WHEN** JSONL 文件中存在无法解析为 JSON 的行
- **THEN** 聚合 SHALL 跳过该行，其余记录 SHALL 正常聚合
