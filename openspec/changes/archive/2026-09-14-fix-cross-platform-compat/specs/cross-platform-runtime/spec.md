## Purpose

跨平台运行时兼容行为：插件在加载期准备目录、以及在子进程注入隔离身份时的语义在 Windows 与 Linux 上保持一致，确保插件在 opencode 两种运行平台上都能成功加载并对每个账号正确隔离。

## ADDED Requirements

### Requirement: 既有目录不影响插件加载（幂等目录准备）

插件在加载/初始化阶段准备日志目录与统计目录时，SHALL 使用幂等的目录准备语义：目标目录已存在时 SHALL NOT 抛错，插件 SHALL 继续加载并注册 hooks 与工具。该行为 SHALL 在 Windows 与 Linux 上一致。

#### Scenario: logDir 已存在仍加载成功

- **WHEN** 插件配置的 `logDir` 指向一个已存在的目录
- **THEN** 插件 SHALL 加载成功并注册 `config` / `event` hook 与工具
- **AND** SHALL NOT 抛出 `EEXIST` 导致 `failed to load plugin`

#### Scenario: statsDir 已存在仍加载成功

- **WHEN** 统计目录（`statsDir` 或默认目录）已存在
- **THEN** 插件 SHALL 加载成功并注册 `config` / `event` hook 与工具
- **AND** SHALL NOT 因目录已存在而加载失败
