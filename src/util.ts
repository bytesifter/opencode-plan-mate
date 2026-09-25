/**
 * 公共工具函数:数值容错与日期。
 */

/** 容错数值转换:非数字归零 */
export function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0
}

/** 本地日期 YYYY-MM-DD(按本地时区) */
export function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
