/**
 * TPM 窗口观测:解析 plan-mate 按日轮转日志的 usage 行,计算每账号"过去 60s 窗口 token"
 * 的分布(p50/p90/max),作为病 C(火山 RPM/TPM 限流)的验证指标。
 *
 * 数据来源:Logger.logUsage 写入的 `plan-mate-<YYYY-MM-DD>.log`(或单文件 logPath),
 * 每行含时间戳 + in/out/reasoning/cacheR/cacheW + provider。日志为追加式按日 JSONL
 * 风格(多进程 append 原子),跨进程数据完整可见——与 stats 层同一持久化哲学。
 *
 * 窗口口径:对每条 usage 记录,窗口 = [t-60s, t] 内所有记录的 token 之和
 * (含本条)。这是服务端 TPM 滑动窗口的客户端近似——验证结论显示服务端判定逻辑
 * 客户端无法精确建模,本指标用于观测"同账号瞬时重叠是否下降、429 是否随重叠减少"。
 */

/** 单条 usage 解析结果 */
export interface TokenSample {
  /** 记录时间戳(毫秒,本地时区解析) */
  t: number
  /** 账号名(provider) */
  provider: string
  /** token 总量(input+output+reasoning+cacheRead+cacheWrite) */
  tokens: number
}

/** 默认窗口(毫秒):对齐火山 TPM 的分钟级限流口径 */
export const DEFAULT_WINDOW_MS = 60_000

/** 时间戳前缀正则(本地时间 YYYY-MM-DD HH:MM:SS.mmm) */
const TS_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.\d{3}/

/** usage 行字段正则:in/out/reasoning/cacheR/cacheW + provider(顺序与 Logger 输出一致) */
const USAGE_RE =
  /INFO\s+usage\s+in=(\d+)\s+out=(\d+)\s+reasoning=(\d+)\s+cacheR=(\d+)\s+cacheW=(\d+)\s+cost=([\d.]+)(?:\s+session=(\S+))?\s+provider=(\S+)/

/**
 * 解析一行 usage 日志。
 * @param line - 单行日志(带前导时间戳)
 * @returns TokenSample,非 usage 行或解析失败返回 undefined
 */
export function parseUsageLine(line: string): TokenSample | undefined {
  const ts = TS_RE.exec(line)
  if (!ts) return undefined
  const fields = USAGE_RE.exec(line)
  if (!fields) return undefined
  const t = Date.parse(`${ts[1]}T${ts[2]}.000+08:00`)
  if (Number.isNaN(t)) return undefined
  const num = (v: string) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  return {
    t,
    provider: fields[8],
    tokens: num(fields[1]) + num(fields[2]) + num(fields[3]) + num(fields[4]) + num(fields[5]),
  }
}

/**
 * 解析多行日志为 TokenSample 列表(跳过空行与解析失败行,不中断)。
 */
export function parseUsageLines(lines: readonly string[]): TokenSample[] {
  const out: TokenSample[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const s = parseUsageLine(line)
    if (s) out.push(s)
  }
  return out
}

/**
 * 对每个样本计算"过去 windowMs 窗口内 token 之和"(含本条),按 provider 分组。
 *
 * 返回 Map<provider, number[]>:数组为每个样本的窗口累计值(顺序与输入一致,
 * 每个 provider 独立)。空输入/无样本返回空 Map。
 */
export function computeWindowSums(
  samples: TokenSample[],
  windowMs: number = DEFAULT_WINDOW_MS,
): Map<string, number[]> {
  const byProvider = new Map<string, TokenSample[]>()
  for (const s of samples) {
    const arr = byProvider.get(s.provider)
    if (arr) arr.push(s)
    else byProvider.set(s.provider, [s])
  }
  const out = new Map<string, number[]>()
  for (const [provider, list] of byProvider) {
    const sorted = [...list].sort((a, b) => a.t - b.t)
    const sums: number[] = []
    // 双指针滑窗:对每个样本 i,维护 [窗口左界, i] 的 token 累计
    let lo = 0
    let acc = 0
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]
      acc += cur.tokens
      while (lo < i && sorted[lo].t < cur.t - windowMs) {
        acc -= sorted[lo].tokens
        lo++
      }
      sums.push(acc)
    }
    out.set(provider, sums)
  }
  return out
}

/**
 * 百分位数(sorted 升序数组)。
 * @param sorted - 升序数值数组(非空)
 * @param q - 0..1
 */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
  return sorted[idx]
}

/**
 * 渲染每账号窗口 token 分布表(p50/p90/max,千分位)。
 * 空数据返回 "暂无 TPM 窗口数据"。
 */
export function renderWindowTable(
  dist: Map<string, number[]>,
  windowSec: number = DEFAULT_WINDOW_MS / 1000,
): string {
  if (dist.size === 0) return "暂无 TPM 窗口数据"
  const lines: string[] = []
  lines.push(`plan-mate 每账号 ${windowSec}s 窗口 token 分布`)
  lines.push(`${"provider".padEnd(16)}  ${"p50".padStart(10)}  ${"p90".padStart(10)}  ${"max".padStart(10)}  n`)
  for (const [provider, sums] of [...dist.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...sums].sort((a, b) => a - b)
    lines.push(
      `${provider.padEnd(16)}  ${fmt(sorted.length ? percentile(sorted, 0.5) : 0)}  ${fmt(sorted.length ? percentile(sorted, 0.9) : 0)}  ${fmt(sorted.length ? sorted[sorted.length - 1] : 0)}  ${sorted.length}`,
    )
  }
  return lines.join("\n")
}

/** 千分位格式化 */
function fmt(n: number): string {
  return n.toLocaleString("en-US").padStart(10)
}
