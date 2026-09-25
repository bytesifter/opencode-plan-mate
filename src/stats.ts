import type { StatsStore, ProviderStats, StatsRecord } from "./types"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ensureDir } from "./fs-util"
import { num, todayLocal } from "./util"

export { todayLocal } from "./util"

/**
 * Usage 输入:单步用量字段(与事件解析层解耦,便于测试)。
 * v2 契约下 `id` 为事件 id,仅作信息记录,不参与去重(去重按 recordUsage 的 eventID 参数)。
 */
export interface UsageInput {
  id?: string
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

/** 扁平 token 快照(用于全零判定) */
interface FlatTokens {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** 默认定时刷盘间隔(毫秒) */
const DEFAULT_FLUSH_MS = 60000

/** 事件 id 去重集合的容量上限:超过后先裁剪过期条目 */
const DEFAULT_MAX_SEEN_EVENTS = 5000

/** 事件 id 去重条目的过期时长(毫秒):超过则视为可裁剪 */
const SEEN_EVENT_MAX_AGE_MS = 10 * 60 * 1000

/**
 * 用量统计收集器:内存累积 + 定时追加刷盘到按日 JSONL。
 *
 * 设计要点:
 * - 通过 ctx.event.subscribe 的 session.step.ended / session.step.failed 事件拿单步用量(v2 契约)
 * - 每个 step 事件计一次 req,无需 token 快照 diff(v1 为累积快照流设计,已退役)
 * - 有界事件 id 去重:同一事件重复到达(事件流重放、多订阅重复处理)不重复累计
 * - 内存累积,60s 定时把自上次刷盘以来的增量(追加式)写入当天 JSONL,崩溃最多丢 1 分钟统计
 * - 追加式写入(O_APPEND + 单次 write)天然原子,多进程并发不互相覆盖
 */
export class StatsCollector {
  private store: StatsStore = {}
  private pending: StatsStore = {}
  private readonly dir: string
  private readonly flushMs: number
  private readonly maxSeenEvents: number
  private timer?: ReturnType<typeof setInterval>
  /** eventID -> 首次到达时间(有界去重集合,Map 保持插入序) */
  private seenEvents: Map<string, number> = new Map()

  constructor(
    dir: string,
    opts: { flushMs?: number; registerExitHooks?: boolean; maxSeenEvents?: number } = {},
  ) {
    this.dir = dir
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS
    this.maxSeenEvents = opts.maxSeenEvents ?? DEFAULT_MAX_SEEN_EVENTS
    ensureDir(this.dir)
    if (opts.registerExitHooks !== false) {
      this.timer = setInterval(() => this.flush(), this.flushMs)
      process.on("beforeExit", this.onBeforeExit)
    }
  }

  /**
   * 累计一条 step 用量。
   * - 缺 tokens 或 tokens 全零时忽略
   * - 传入非空 dedupeKey 时去重:同一去重身份重复到达返回 false
   *
   * @param info - 单步用量信息
   * @param provider - 实际服务的 provider 名(corrMap 或 fallback)
   * @param dedupeKey - 去重身份(durableKey: `aggregateID:seq`,缺 durable 时为 event.id;空串不去重)
   * @returns 是否累加了(用于日志)
   */
  recordUsage(info: UsageInput, provider: string, dedupeKey?: string): boolean {
    if (!info.tokens) return false
    const snapshot = toSnapshot(info.tokens)
    if (isAllZero(snapshot)) return false
    if (dedupeKey) {
      if (this.seenEvents.has(dedupeKey)) return false
      this.remember(dedupeKey)
    }
    this.commitToStore(info, provider)
    return true
  }

  /** 记录事件 id 到去重集合,超过容量时先裁剪过期条目 */
  private remember(eventID: string): void {
    const now = Date.now()
    if (this.seenEvents.size >= this.maxSeenEvents) {
      this.pruneSeen(now)
    }
    this.seenEvents.set(eventID, now)
  }

  /** 裁剪过期条目;仍超容时按插入序(最旧)删除至容量内 */
  private pruneSeen(now: number): void {
    for (const [id, ts] of this.seenEvents) {
      if (now - ts > SEEN_EVENT_MAX_AGE_MS) this.seenEvents.delete(id)
    }
    while (this.seenEvents.size >= this.maxSeenEvents) {
      const oldest = this.seenEvents.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.seenEvents.delete(oldest)
    }
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

/** 检查 token 快照是否全零(非真实用量报告的 step 事件) */
function isAllZero(s: FlatTokens): boolean {
  return s.input === 0 && s.output === 0 && s.reasoning === 0 && s.cacheRead === 0 && s.cacheWrite === 0
}

/** 将 tokens 结构转换为扁平快照(容错:非数字归零) */
function toSnapshot(tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }): FlatTokens {
  return {
    input: num(tokens.input),
    output: num(tokens.output),
    reasoning: num(tokens.reasoning),
    cacheRead: num(tokens.cache.read),
    cacheWrite: num(tokens.cache.write),
  }
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
