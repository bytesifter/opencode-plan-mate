import type { ProviderEntry } from "./types"

/** 冷却记录:记录到期时间戳 */
interface CooldownEntry {
  /** 到期时间戳(毫秒) */
  until: number
}

/**
 * provider 池:负责随机选 provider 与 cooldown 管理。
 *
 * - 随机选择无状态,不维护轮询位置
 * - 同接入点(baseURL)内轮询:请求从哪个接入点发出,就在该接入点下按模型过滤后随机选
 * - cooldown 仅标记不重试,失败交 opencode 原生
 * - 全部 provider 冷却时返回 null(passthrough)
 */
export class ProviderPool {
  private readonly entries: ProviderEntry[]
  private readonly byBaseURL = new Map<string, ProviderEntry[]>()
  readonly cooldownMs: number
  readonly quotaCooldownMs: number
  private readonly cooldowns = new Map<string, CooldownEntry>()

  constructor(entries: ProviderEntry[], cooldownMs: number, quotaCooldownMs: number = 3600000) {
    this.entries = entries
    this.cooldownMs = cooldownMs
    this.quotaCooldownMs = quotaCooldownMs
    for (const e of entries) {
      const arr = this.byBaseURL.get(e.baseURL)
      if (arr) {
        arr.push(e)
      } else {
        this.byBaseURL.set(e.baseURL, [e])
      }
    }
  }

  /** 池内 provider 条目数(用于判断是否注册拦截器) */
  get entryCount(): number {
    return this.entries.length
  }

  /**
   * 随机选一个非熔断 provider。
   *
   * @param model - 请求 body 中的模型名,有匹配时在同接入点内按模型过滤
   * @param originBaseURL - 原始请求的 baseURL(接入点),同接入点内轮询
   * @returns 选中的 ProviderEntry,或 null(全熔断/接入点无 provider)
   */
  next(model?: string, originBaseURL?: string): ProviderEntry | null {
    const now = Date.now()
    const basePool = originBaseURL ? this.byBaseURL.get(originBaseURL) : this.entries
    if (!basePool || basePool.length === 0) return null
    let pool = basePool
    if (model) {
      const filtered = basePool.filter((e) => e.models.includes(model))
      if (filtered.length > 0) pool = filtered
    }
    const available = pool.filter((e) => !this.isCoolingDown(e.key, now))
    if (available.length === 0) return null
    const idx = Math.floor(Math.random() * available.length)
    return available[idx]
  }

  /**
   * 标记某 provider 熔断(收到 429 后调用)。
   *
   * @param key - 被限流的 provider 的 key
   * @param ms - 自定义冷却时长(毫秒),不传时用 pool 默认 cooldownMs
   */
  markCooldown(key: string, ms?: number): void {
    this.cooldowns.set(key, { until: Date.now() + (ms ?? this.cooldownMs) })
  }

  /**
   * 查询某 key 是否在冷却中。已过期的记录会被惰性清理。
   */
  isCoolingDown(key: string, now: number = Date.now()): boolean {
    const entry = this.cooldowns.get(key)
    if (!entry) return false
    if (now >= entry.until) {
      this.cooldowns.delete(key)
      return false
    }
    return true
  }

  /**
   * 返回 key 在列表中的序号(用于日志脱敏)。
   */
  keyIndex(key: string): number {
    return this.entries.findIndex((e) => e.key === key)
  }

  /**
   * 按 key 反查 provider 条目(http.response 用 Authorization 头识别 key 后取条目)。未找到返回 undefined。
   */
  entryByKey(key: string): ProviderEntry | undefined {
    return this.entries.find((e) => e.key === key)
  }

  /**
   * 返回 key 对应的账号名(用于日志)。未找到返回 "unknown"。
   */
  accountName(key: string): string {
    return this.entries.find((e) => e.key === key)?.account ?? "unknown"
  }

  /**
   * 查找 URL 匹配的已配置 baseURL(用于提取路径前缀)。
   * 返回首个匹配的 baseURL,不匹配返回 null。
   */
  findBaseURL(url: string): string | null {
    for (const e of this.entries) {
      if (url.startsWith(e.baseURL)) return e.baseURL
    }
    return null
  }
}
