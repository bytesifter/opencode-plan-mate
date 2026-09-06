import type { StatsStore, ProviderStats } from "./types"

/** 默认展示天数 */
const DEFAULT_DAYS = 7

/** 柱状图最大宽度(字符数) */
const BAR_WIDTH = 12

/**
 * 由统计 store 生成按天的 ASCII 柱状图(per-provider 视图)。
 *
 * 每行一个日期,按 provider 分列展示请求数与 token。
 * 日维度汇总通过遍历当天所有 provider 求和获得。
 *
 * @param store - 统计数据
 * @param days - 展示最近多少天,默认 7
 * @returns 图表字符串;无数据时返回"暂无统计数据"
 */
export function renderChart(store: StatsStore, days: number = DEFAULT_DAYS): string {
  const entries = recentDays(store, days)
  if (entries.length === 0) return "暂无统计数据"

  const allProviders = collectProviders(entries)
  if (allProviders.length === 0) return "暂无统计数据"

  const maxReq = Math.max(
    ...entries.flatMap((e) => allProviders.map((p) => e.stats[p]?.req ?? 0)),
    1,
  )
  const maxTok = Math.max(
    ...entries.flatMap((e) => allProviders.map((p) => totalToken(e.stats[p]))),
    1,
  )

  const lines: string[] = []
  lines.push(`round-robin 近 ${days} 天 per-provider 统计`)
  const header = `日期      ${allProviders.map((p) => pad(p, 20)).join("  ")}`
  lines.push(header)
  lines.push(`${" ".repeat(10)}${allProviders.map(() => "请求      token       ").join("  ")}`)

  for (const { day, stats } of entries) {
    const date = day.slice(5)
    const cols = allProviders.map((p) => {
      const ps = stats[p]
      const req = ps?.req ?? 0
      const tok = ps ? totalToken(ps) : 0
      const reqBar = bar(req, maxReq, BAR_WIDTH)
      const tokBar = bar(tok, maxTok, BAR_WIDTH)
      return `${reqBar} ${String(req).padStart(4)} ${tokBar} ${fmtTok(tok).padStart(6)}`
    })
    lines.push(`${date}  ${cols.join("  ")}`)
  }

  lines.push("")
  const totals = allProviders.map((p) => {
    const totalReq = entries.reduce((sum, e) => sum + (e.stats[p]?.req ?? 0), 0)
    const totalTok = entries.reduce((sum, e) => sum + (e.stats[p] ? totalToken(e.stats[p]) : 0), 0)
    return `${pad(p, 20)} 请求=${totalReq} token=${fmtTok(totalTok)}`
  })
  lines.push(`合计: ${totals.join("  ")}`)

  return lines.join("\n")
}

/**
 * 取 store 中最近 N 天(按日期降序,仅含有数据的天)。
 */
function recentDays(
  store: StatsStore,
  days: number,
): { day: string; stats: Record<string, ProviderStats> }[] {
  return Object.entries(store)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, days)
    .map(([day, stats]) => ({ day, stats }))
}

/** 收集所有出现过的 provider 名(保持稳定排序) */
function collectProviders(
  entries: { day: string; stats: Record<string, ProviderStats> }[],
): string[] {
  const set = new Set<string>()
  for (const { stats } of entries) {
    for (const p of Object.keys(stats)) set.add(p)
  }
  return [...set].sort()
}

/** 单个 provider 的 token 总消耗(input+output+reasoning+cache) */
function totalToken(s: ProviderStats | undefined): number {
  if (!s) return 0
  return s.in + s.out + s.reasoning + s.cacheRead + s.cacheWrite
}

/** 生成归一化柱:█ 填充,· 空白 */
export function bar(value: number, max: number, width: number): string {
  if (max <= 0) return " ".repeat(width)
  const filled = Math.round((value / max) * width)
  return "█".repeat(filled).padEnd(width, "·")
}

/** 格式化 token 数:>=1000 用 k 后缀 */
function fmtTok(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k"
  return String(n)
}

/** 截断或填充字符串到指定宽度 */
export function pad(s: string, width: number): string {
  if (s.length > width) return s.slice(0, width)
  return s.padEnd(width)
}
