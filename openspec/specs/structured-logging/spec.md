### Requirement: 日志级别

日志 SHALL 包含级别标签: `INFO`(正常请求/消息完成)、`WARN`(429/402 冷却)、`ERROR`(非 2xx 响应)。每条日志行 SHALL 在时间戳后紧跟级别标签。

#### Scenario: fetch 层 200 响应记 INFO

- **WHEN** fetch 拦截器收到 HTTP 200 响应
- **THEN** 日志行 SHALL 包含 `INFO` 级别标签

#### Scenario: fetch 层 429 响应记 WARN

- **WHEN** fetch 拦截器收到 HTTP 429 响应
- **THEN** 日志行 SHALL 包含 `WARN` 级别标签
- **AND** 冷却日志 SHALL 也使用 `WARN` 级别

#### Scenario: fetch 层 402 响应记 WARN

- **WHEN** fetch 拦截器收到 HTTP 402 响应
- **THEN** 日志行 SHALL 包含 `WARN` 级别标签
- **AND** 冷却日志 SHALL 也使用 `WARN` 级别

#### Scenario: fetch 层 500 响应记 ERROR

- **WHEN** fetch 拦截器收到 HTTP 5xx 响应
- **THEN** 日志行 SHALL 包含 `ERROR` 级别标签

### Requirement: event 层业务上下文

event 层日志 SHALL 包含以下业务字段: `session`(从 `info.sessionID` 截短为前 8 位)、`model`(modelID)、`provider`(providerID)、`mode`(模式)、`agent`(agent 名)。SHALL NOT 记录完整 sessionID(隐私)。`session` 字段 SHALL 从 `info.sessionID`(`AssistantMessage.sessionID`)提取,SHALL NOT 从 `event.properties` 顶层提取(后者不存在该字段)。同一 `info.id` 的消息 SHALL 至多产生一行 event 层日志(与统计的去重真相源同步)。

#### Scenario: 终态消息记一行日志且含完整业务上下文

- **WHEN** `message.updated` 事件的 `info.role` 为 `assistant`、`info.tokens` 存在、`info.finish` 存在,且 `info.id` 未被记过日志
- **THEN** 日志行 SHALL 写入一行,包含 `session`/`model`/`provider`/`mode`/`agent` 字段
- **AND** `session` 字段 SHALL 为 `info.sessionID` 的前 8 位(非完整值)

#### Scenario: 流式中途更新不记日志

- **WHEN** `message.updated` 事件的 `info` 不含 `finish`(流式中途更新)
- **THEN** SHALL NOT 写入 event 层日志行

#### Scenario: 同一消息 id 不重复记日志

- **WHEN** `message.updated` 事件的 `info.id` 已被记过日志(统计层已提交该 id)
- **THEN** SHALL NOT 再次写入 event 层日志行

#### Scenario: sessionID 来源为 info.sessionID

- **WHEN** `message.updated` 事件触发且 `info.finish` 存在
- **THEN** `session` 字段 SHALL 取自 `info.sessionID`
- **AND** SHALL NOT 取自 `event.properties.sessionID`(该字段不存在)

### Requirement: fetch 层不含 URL

fetch 层日志 SHALL NOT 包含请求 URL。SHALL 记录: `provider`(账号名)、`key`(序号+末 4 位)、`status`(HTTP 状态码)、`duration`(耗时毫秒)。

#### Scenario: fetch 层日志格式

- **WHEN** fetch 拦截器收到响应
- **THEN** 日志行 SHALL 包含 `provider`/`key`/`status`/`duration` 字段
- **AND** 日志行 SHALL NOT 包含 URL 或路径

### Requirement: 请求耗时

fetch 层 SHALL 记录请求耗时(从发起到收到响应的毫秒数)。event 层 SHALL 记录消息耗时(从 `time.created` 到 `time.completed` 的毫秒数)。

#### Scenario: fetch 层耗时

- **WHEN** fetch 拦截器发送请求并收到响应
- **THEN** 日志行 SHALL 包含 `duration` 字段,值为正整数(毫秒)

#### Scenario: event 层耗时

- **WHEN** `message.updated` 事件携带 `time.created` 和 `time.completed`
- **THEN** 日志行 SHALL 包含 `duration` 字段,值为 `time.completed - time.created`(毫秒)
- **WHEN** `time.completed` 不存在
- **THEN** `duration` 字段 SHALL 缺省或为 0

### Requirement: 按日轮转(默认启用)

日志 SHALL 按日轮转,文件名格式为 `round-robin-YYYY-MM-DD.log`(本地时区)。旧日志文件 SHALL 保留,不自动删除。

#### Scenario: 跨天写入新文件

- **WHEN** 本地时间从 2026-07-26 23:59:59 变为 2026-07-27 00:00:00
- **THEN** 新日志行 SHALL 写入 `round-robin-2026-07-27.log`
- **AND** `round-robin-2026-07-26.log` SHALL 保留在磁盘上

#### Scenario: 同一天写入同一文件

- **WHEN** 同一天内多次写入日志
- **THEN** 所有日志行 SHALL 追加到同一个 `round-robin-YYYY-MM-DD.log` 文件

### Requirement: logDir 与 logPath 配置

插件 options SHALL 支持可选 `logDir` 字段(日志目录路径)和 `logPath` 字段(日志文件路径)。日志模式由 `logPath` 和 `logDir` 共同决定,优先级: `logPath > logDir > 默认`。当 `logPath` 存在时,使用 `logPath` 单文件模式(不轮转),忽略 `logDir`。当 `logPath` 不存在时,使用 `logDir`(若存在)或默认目录(`~/.local/share/opencode/`)启用按日轮转模式。

#### Scenario: 均未配置 -- 默认轮转

- **WHEN** `opencode.jsonc` 中未配置 `logDir` 和 `logPath`
- **THEN** 日志 SHALL 写入 `~/.local/share/opencode/round-robin-YYYY-MM-DD.log`(按日轮转)

#### Scenario: 配置 logDir 自定义轮转目录

- **WHEN** `opencode.jsonc` 中配置 `"logDir": "/var/log/opencode"`(无 `logPath`)
- **THEN** 日志 SHALL 写入 `/var/log/opencode/round-robin-YYYY-MM-DD.log`

#### Scenario: 配置 logPath 强制单文件

- **WHEN** `opencode.jsonc` 中配置 `"logPath": "/tmp/rr.log"`(无论是否配 `logDir`)
- **THEN** 日志 SHALL 追加到 `/tmp/rr.log`(单文件,不轮转)
- **AND** `logDir` SHALL 被忽略

### Requirement: key 脱敏

日志中的 API key SHALL 脱敏,仅保留末 4 位,前缀以 `..` 表示。SHALL NOT 记录完整 key。账号名(provider 名)非敏感,可明文记录。

#### Scenario: key 脱敏格式

- **WHEN** 记录 key 为 `ark-test-key-xxxx-22898`
- **THEN** 日志中 SHALL 显示为 `..2898`
- **AND** SHALL NOT 出现完整 key 字符串

### Requirement: 冷却日志区分类型

429/402 冷却日志 SHALL 包含类型标签(`rate-limit` 或 `quota-exhausted`)与实际冷却时长(毫秒)。类型标签 SHALL 基于响应状态码与响应体判断:配额耗尽 429(`error.message` 含 `exceeded` 与 `quota`)记为 `quota-exhausted`;余额不足 402 记为 `quota-exhausted`;其他 429(含响应体不可读)记为 `rate-limit`。日志格式 SHALL 为 `WARN  cooldown provider=<账号> key=#<序号>(..<末4位>) <类型> <时长>ms`。

#### Scenario: 请求太快冷却日志

- **WHEN** 某 provider 收到请求太快 429 并被标记短熔断
- **THEN** 冷却日志 SHALL 包含 `rate-limit` 标签与 `cooldownMs` 时长

#### Scenario: 配额耗尽冷却日志

- **WHEN** 某 provider 收到配额耗尽 429 并被标记长熔断
- **THEN** 冷却日志 SHALL 包含 `quota-exhausted` 标签与 `quotaCooldownMs` 时长

#### Scenario: 余额不足 402 冷却日志

- **WHEN** 某 provider 收到 402 响应并被标记长熔断
- **THEN** 冷却日志 SHALL 包含 `quota-exhausted` 标签与 `quotaCooldownMs` 时长

#### Scenario: 响应体不可读时记 rate-limit

- **WHEN** 某 provider 收到 429 但响应体无法读取或 JSON 解析失败
- **THEN** 冷却日志 SHALL 记为 `rate-limit` 标签与 `cooldownMs` 时长
