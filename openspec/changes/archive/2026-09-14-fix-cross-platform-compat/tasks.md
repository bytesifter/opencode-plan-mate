## 1. 幂等目录准备（src/logger.ts、src/stats.ts）

- [x] 1.1 `Logger` 构造函数改为幂等准备目录（目录已存在则跳过 `mkdirSync`），验证：新增单测「logDir 已存在时构造不抛错、且能追加写入」，断言不抛 `EEXIST`
- [x] 1.2 `StatsCollector` 构造函数改为幂等准备目录，验证：新增单测「statsDir 已存在时构造不抛错」，断言不抛 `EEXIST`
- [x] 1.3 抽取/复用一致的目录准备语义（两处行为一致），验证：`bun test` 中原 logger/stats 测试全部通过

## 2. 跨平台账号隔离（src/quota.ts）

- [x] 2.1 `volcArkcliAdapter.fetch` 注入的 env 增加 `USERPROFILE: home`（保留 `HOME: home` 与归因变量），验证：新增/更新单测断言 spawn 收到的 env 同时含 `HOME` 与 `USERPROFILE`，值均为该账号 home
- [x] 2.2 确认多账号各自 spawn 的隔离 env 互不相同，验证：单测对两个账号断言各自 env 指向各自 home

## 3. 路径展开兼容 `~\`（src/config.ts）

- [x] 3.1 `expandHome` 同时识别 `~/` 与 `~\` 前缀，验证：新增单测断言 `~/.arkcli-accounts/a` 与 `~\.arkcli-accounts\a` 均展开为 `join(homedir(), ".arkcli-accounts", "a")`

## 4. 文档更新

- [x] 4.1 `docs/getting-started/installation.md` 补充 Windows 说明（`logDir` 可指向已存在目录；`file:///D:/...` 写法），验证：文档含可复制的 Windows 示例
- [x] 4.2 `docs/user-guide/plan-stats.md` 更新登录步骤：`arkcli config init` → `arkcli profile create`；Windows 用 `$env:USERPROFILE=<home>` 而非 `HOME=`，验证：文档中 Windows/POSIX 步骤分别可执行

## 5. 验证

- [x] 5.1 运行 `bun test` 全量通过
- [x] 5.2 运行 `bunx tsc --noEmit` 类型检查通过

## 6. 构建产物同步（运行时生效）

- [x] 6.1 运行 `bun run build` 重新生成 `dist/index.js`，验证：`dist` 内 `Logger`/`StatsCollector` 的目录准备含幂等守卫（`existsSync`），且 `quota` 的 env 含 `USERPROFILE`
- [x] 6.2 运行时实测（Windows）：配置 `logDir` 指向一个已存在目录，重启 opencode 后调用 `roundrobin_stats`，验证：插件加载成功、无 `failed to load plugin`，工具可调用
