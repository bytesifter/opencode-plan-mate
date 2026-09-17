## Context

改名的动机见 proposal.md — Why。当前代码中旧名分散在 4 个 src 文件 + 1 个测试文件，共 13 处代码引用，另有 10 处文档中的 `roundrobin_stats` 工具名引用。关键约束：`openspec/specs/`、`archive/`、`articles/` 与磁盘旧数据不动（用户决策），因此存在「spec 记录的旧工具名 vs 代码新工具名」的已知短期不一致。

## Goals / Non-Goals

**Goals:**
- 全代码库（除用户明确排除项外）统一到 `opencode-plan-mate` 命名
- LLM 工具 `roundrobin_stats` → `plan_mate_stats`，description 同步
- 新写入的统计目录与日志文件名使用 `plan-mate-*` 前缀
- 构建产物 `dist/` 与 `bun.lock` 与 package.json 一致

**Non-Goals:**
- 不修改 `openspec/specs/`、`changes/archive/`、`articles/`
- 不迁移磁盘旧数据（旧 `round-robin-stats/`、`round-robin-*.log` 留在原地）
- 不改 GitHub 仓库名、本地目录名、用户 `opencode.jsonc` 的 `file:///` 路径（外部操作）

## Decisions

- **新名 `opencode-plan-mate`**：以「Coding Plan 助手」为身份锚点。`opencode` 前缀固定；不绑定平台（火山/ark）与机制（round-robin），避免再次因名字低估产品。
- **工具名 `roundrobin_stats` → `plan_mate_stats`**：与品牌一致。LLM 通过 description 引导调用工具，用户口语「看轮询统计」仍可命中，故改名无实际习惯成本。
- **磁盘命名切换、旧数据留原地**：新写入 `plan-mate-stats/`、`plan-mate-*.log`；旧文件不迁移。历史统计断档为已知取舍，换取零迁移风险。
- **`skip_specs: true`**：honor 用户「spec 不动」决策。已知代价：`usage-tracking` spec 中 `roundrobin_stats` 工具名与代码短期不一致。

## Risks / Trade-offs

- [工具名/路径改名后旧数据不可见] → 用户已接受历史统计断档；旧文件物理保留，可手动备份
- [spec 与代码工具名短期不一致] → 明确记录在 proposal 的 Known Trade-off，留待后续单独 change 处理 spec 同步
- [文档文件 `round-robin.md` 改名后外部链接失效] → 本项目文档为仓库内相对引用，无外部链接依赖

## Migration Plan

1. 改代码 + 测试 + package.json（本 change）
2. `bun run build` 重建 `dist/`，`bun install` 刷新 `bun.lock`
3. 更新 README 与 docs/
4. 验证：`bun run typecheck` + `bun test` + grep 无旧名残留（排除排除项）
5. 仓库外部（repo 名/目录名/opencode.jsonc）由用户另行处理

## Open Questions

无。
