import type { StatsStore, ProviderStats } from "./types"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

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
 * 用量统计收集器:内存累积 + 定时刷盘到 JSON。
 *
 * 设计要点(见 design 决策 2):
 * - 通过 event hook 的 message.updated 拿 usage,不解析 SSE 流
 * - token 快照变化检测:不同 token = 新 step,累加;相同 = re-emission,跳过
 * - 内存累积,60s 定时刷盘,崩溃最多丢 1 分钟统计
 */
export class StatsCollector {
  private store: StatsStore = {}
  private readonly path: string
  private readonly flushMs: number
  private timer?: ReturnType<typeof setInterval>
  private lastTokens: Map<string, TokenSnapshot> = new Map()

  constructor(
    path: string,
    opts: { flushMs?: number; registerExitHooks?: boolean } = {},
  ) {
    this.path = path
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS
    this.load()
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
    const dayData = this.store[day] ?? {}
    const s = dayData[provider] ?? newProviderStats()
    s.req++
    s.in += num(info.tokens.input)
    s.out += num(info.tokens.output)
    s.reasoning += num(info.tokens.reasoning)
    s.cacheRead += num(info.tokens.cache.read)
    s.cacheWrite += num(info.tokens.cache.write)
    if (typeof info.cost === "number") s.cost += info.cost
    dayData[provider] = s
    this.store[day] = dayData
  }

  /** 读取内存 store(图表工具用) */
  getStore(): StatsStore {
    return this.store
  }

  /** 立即刷盘到 JSON 文件 */
  flush(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.store, null, 2))
  }

  /** 从 JSON 加载(文件不存在/损坏/旧格式则置空) */
  load(): void {
    if (!existsSync(this.path)) {
      this.store = {}
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"))
      if (!isCompatibleFormat(parsed)) {
        this.store = {}
        return
      }
      this.store = parsed as StatsStore
    } catch {
      this.store = {}
    }
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

/**
 * 检测 JSON 是否为新格式(date -> provider -> stats)。
 * 旧格式:date -> DayStats(直接含 req 字段)。
 */
function isCompatibleFormat(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) return false
    if ("req" in v && typeof (v as { req: unknown }).req === "number") return false
    break
  }
  return true
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
