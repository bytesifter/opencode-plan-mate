import { existsSync, mkdirSync } from "node:fs"

/**
 * 幂等准备目录:目录已存在时跳过 `mkdirSync`。
 *
 * opencode 内嵌运行时在 Windows 下对已存在目录的 `mkdirSync(..., { recursive: true })`
 * 会抛 `EEXIST`,导致插件在加载期(Logger/StatsCollector 构造)整体加载失败。
 * 该守卫保证插件不因既有目录而无法加载(见 fix-cross-platform-compat)。
 *
 * @param dir - 目标目录路径
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
