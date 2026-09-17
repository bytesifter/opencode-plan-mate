## 1. 代码改名

- [x] 1.1 `src/index.ts` 改名：`:33` 默认统计目录 `round-robin-stats` → `plan-mate-stats`；`:106` 工具名 `roundrobin_stats` → `plan_mate_stats`；`:107` description 中 `opencode-round-robin` → `opencode-plan-mate`；`:134` plugin `id` → `opencode-plan-mate`。验证：`rg "opencode-round-robin|round-robin|roundrobin" src/index.ts` 无结果
- [x] 1.2 `src/config.ts` 错误前缀 ×7（:20/:24/:29/:86/:93/:98/:101）`opencode-round-robin:` → `opencode-plan-mate:`。验证：`rg "opencode-round-robin" src/config.ts` 无结果
- [x] 1.3 `src/logger.ts:107` 日志前缀 `round-robin-` → `plan-mate-`；`src/chart.ts:36` 标题 `round-robin` → `plan-mate`。验证：`rg "round-robin|roundrobin" src/logger.ts src/chart.ts` 无结果
- [x] 1.4 `tests/logger.test.ts` 日志文件名断言 ×3（:158/:159/:173）`round-robin-` → `plan-mate-`。验证：`bun test tests/logger.test.ts` 通过
- [x] 1.5 `package.json` name → `opencode-plan-mate`。验证：`rg '"name"' package.json` 输出新名

## 2. 构建与验证

- [x] 2.1 `bun install` 刷新 bun.lock，`bun run build` 重建 dist/index.js。验证：构建成功且 `rg "opencode-round-robin|roundrobin" dist/index.js` 无结果
- [x] 2.2 全量测试与类型检查：`bun test` + `bunx tsc --noEmit`。验证：两者通过

## 3. 文档同步

- [x] 3.1 `README.md` 更新：标题、clone URL、plugin 声明路径、工具表（`roundrobin_stats` → `plan_mate_stats`）、文档链接。验证：`rg "round-robin|roundrobin|opencode-round-robin" README.md` 无结果
- [x] 3.2 `docs/getting-started/installation.md` 更新：clone URL、plugin 路径、统计/日志路径、`roundrobin_stats` 引用。验证：`rg "round-robin|roundrobin|opencode-round-robin" docs/getting-started/installation.md` 无结果
- [x] 3.3 `docs/user-guide/round-robin.md` 重命名为 `docs/user-guide/plan-mate-stats.md` 并更新内容：工具名引用、统计路径、日志路径。验证：旧文件不存在、新文件存在且 `rg "round-robin|roundrobin|opencode-round-robin" docs/user-guide/plan-mate-stats.md` 无结果
- [x] 3.4 `docs/user-guide/plan-stats.md` 更新 `roundrobin_stats` 引用 ×5（:5/:7）及其它旧名引用。验证：`rg "round-robin|roundrobin|opencode-round-robin" docs/user-guide/plan-stats.md` 无结果
- [x] 3.5 `docs/technical/plan-stats/README.md` 更新 `roundrobin_stats` 引用 ×2（:5/:67）。验证：`rg "roundrobin|round-robin|opencode-round-robin" docs/technical/plan-stats/README.md` 无结果

## 4. 残留核验

- [x] 4.1 全仓 grep 核验（排除 node_modules/.git/dist/openspec/archive/articles）：`rg "round-robin|roundrobin|opencode-round-robin"` 仅在排除项内残留。验证：src/tests/docs/README/package.json 均无残留
