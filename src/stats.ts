import type { StatsStore, ProviderStats, StatsRecord } from "./types"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Usage 输入:从 AssistantMessage 提取的字段(与 @opencode-ai/sdk 解耦,便于测试)。
 */
export interface UsageInput {
  id: string
  role?: string
  finish?: string
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  cost?: number
}

/** token 快照,用于检测新 step vs re-emission */
interface TokenSnapshot {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** 终态 finish 值:表示消息处理结束,可清理关联映射 */
const TERMINAL_FINISH = new Set(["stop", "error", "unknown"])

/** 默认定时刷盘间隔(毫秒) */
const DEFAULT_FLUSH_MS = 60000

/**
 * 用量统计收集器:内存累积 + 定时追加刷盘到按日 JSONL。
 *
 * 设计要点:
 * - 通过 event hook 的 message.updated 拿 usage,不解析 SSE 流
 * - token 快照变化检测:不同 token = 新 step,累加;相同 = re-emission,跳过
 * - 内存累积,60s 定时把自上次刷盘以来的增量(追加式)写入当天 JSONL,崩溃最多丢 1 分钟统计
 * - 追加式写入(O_APPEND + 单次 write)天然原子,多进程并发不互相覆盖
 */
export class StatsCollector {
  private store: StatsStore = {}
  private pending: StatsStore = {}
  private readonly dir: string
  private readonly flushMs: number
  private timer?: ReturnType<typeof setInterval>
  private lastTokens: Map<string, TokenSnapshot> = new Map()

  constructor(
    dir: string,
    opts: { flushMs?: number; registerExitHooks?: boolean } = {},
  ) {
    this.dir = dir
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS
    mkdirSync(this.dir, { recursive: true })
    if (opts.registerExitHooks !== false) {
      this.timer = setInterval(() => this.flush(), this.flushMs)
      process.on("beforeExit", this.onBeforeExit)
    }
  }

  /**
   * 累计一条 usage。按 id + token 快照去重:
   * - 同一 id 的 token 快照变化(新 step)-> 累加到指定 provider
   * - 同一 id 的 token 快照相同(re-emission)-> 跳过
   * 缺 id 或 tokens 时忽略。
   *
   * @param info - message.updated 的 usage 信息
   * @param provider - 实际服务的 provider 名(corrMap 或 fallback)
   * @returns 是否累加了(用于日志)
   */
  recordUsage(info: UsageInput, provider: string): boolean {
    if (!info.id || !info.tokens) return false
    const snapshot: TokenSnapshot = {
      input: num(info.tokens.input),
      output: num(info.tokens.output),
      reasoning: num(info.tokens.reasoning),
      cacheRead: num(info.tokens.cache.read),
      cacheWrite: num(info.tokens.cache.write),
    }
    if (isAllZero(snapshot)) return false
    const prev = this.lastTokens.get(info.id)
    if (prev && sameSnapshot(prev, snapshot)) {
      return false
    }
    this.commitToStore(info, provider)
    this.lastTokens.set(info.id, snapshot)
    return true
  }

  private commitToStore(info: UsageInput, provider: string): void {
    if (!info.tokens) return
    const day = todayLocal()
    addTo(this.store, day, provider, info.tokens, info.cost)
    addTo(this.pending, day, provider, info.tokens, info.cost)
  }

  /** 读取内存 store(图表工具用) */
  getStore(): StatsStore {
    return this.store
  }

  /** 立即把自上次刷盘以来的增量追加写入当天 JSONL 文件 */
  flush(): void {
    if (isEmpty(this.pending)) return
    for (const [day, providers] of Object.entries(this.pending)) {
      const file = join(this.dir, `${day}.jsonl`)
      for (const [provider, s] of Object.entries(providers)) {
        const rec: StatsRecord = {
          day,
          provider,
          req: s.req,
          in: s.in,
          out: s.out,
          reasoning: s.reasoning,
          cacheRead: s.cacheRead,
          cacheWrite: s.cacheWrite,
          cost: s.cost,
        }
        appendFileSync(file, JSON.stringify(rec) + "\n")
      }
    }
    this.pending = {}
  }

  /** 停止定时器并刷盘(测试与卸载用) */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.flush()
  }

  private onBeforeExit = () => {
    this.flush()
  }
}

function newProviderStats(): ProviderStats {
  return { req: 0, in: 0, out: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
}

/** 比较 two token snapshots 是否相同 */
function sameSnapshot(a: TokenSnapshot, b: TokenSnapshot): boolean {
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.reasoning === b.reasoning &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite
  )
}

/** 检查 token 快照是否全零(opencode 创建 assistant 消息时的初始事件) */
function isAllZero(s: TokenSnapshot): boolean {
  return s.input === 0 && s.output === 0 && s.reasoning === 0 && s.cacheRead === 0 && s.cacheWrite === 0
}

/** 容错数值转换:非数字归零 */
function num(v: unknown): number {
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

/** 向 store 的 (day, provider) 累加一次用量增量 */
function addTo(
  store: StatsStore,
  day: string,
  provider: string,
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } },
  cost: number | undefined,
): void {
  const dayData = store[day] ?? {}
  const s = dayData[provider] ?? newProviderStats()
  s.req++
  s.in += num(tokens.input)
  s.out += num(tokens.output)
  s.reasoning += num(tokens.reasoning)
  s.cacheRead += num(tokens.cache.read)
  s.cacheWrite += num(tokens.cache.write)
  if (typeof cost === "number") s.cost += cost
  dayData[provider] = s
  store[day] = dayData
}

/** 判断 store 是否没有任何记录 */
function isEmpty(store: StatsStore): boolean {
  return Object.keys(store).length === 0
}

/** 本地日期往前 n 天(YYYY-MM-DD) */
function dayOffset(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * 聚合 statsDir 下最近 N 天的 JSONL 增量记录为 StatsStore。
 * 同一 (day, provider) 的所有增量逐字段求和;无法解析的行跳过,不中断聚合。
 *
 * @param dir - 统计目录
 * @param days - 聚合最近多少天
 * @returns 聚合后的统计(与现有 StatsStore 同构)
 */
export function aggregateStats(dir: string, days: number): StatsStore {
  const out: StatsStore = {}
  for (let i = days - 1; i >= 0; i--) {
    const file = join(dir, `${dayOffset(i)}.jsonl`)
    if (!existsSync(file)) continue
    const lines = readFileSync(file, "utf8").split("\n")
    for (const line of lines) {
      if (!line.trim()) continue
      let rec: StatsRecord
      try {
        rec = JSON.parse(line) as StatsRecord
      } catch {
        continue
      }
      const s = (out[rec.day] ?? {})[rec.provider] ?? newProviderStats()
      s.req += num(rec.req)
      s.in += num(rec.in)
      s.out += num(rec.out)
      s.reasoning += num(rec.reasoning)
      s.cacheRead += num(rec.cacheRead)
      s.cacheWrite += num(rec.cacheWrite)
      s.cost += num(rec.cost)
      const dayData = out[rec.day] ?? {}
      dayData[rec.provider] = s
      out[rec.day] = dayData
    }
  }
  return out
}
