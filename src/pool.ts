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
  /** key → entries 数组序号(构造序,替代 keyIndex 线性 findIndex) */
  private readonly byKeyIndex = new Map<string, number>()
  /** key → 条目(替代 entryByKey 线性 find) */
  private readonly byKeyEntry = new Map<string, ProviderEntry>()
  /** key → 账号名(替代 accountName 线性 find) */
  private readonly byKeyAccount = new Map<string, string>()
  /** baseURL → 该接入点内条目模型集是否有差异(构造时计算,extractModel 守卫用) */
  private readonly modelVariance = new Map<string, boolean>()
  readonly cooldownMs: number
  readonly quotaCooldownMs: number
  private readonly cooldowns = new Map<string, CooldownEntry>()

  constructor(entries: ProviderEntry[], cooldownMs: number, quotaCooldownMs: number = 3600000) {
    this.entries = entries
    this.cooldownMs = cooldownMs
    this.quotaCooldownMs = quotaCooldownMs
    for (const e of entries) {
      this.byKeyIndex.set(e.key, this.byKeyEntry.size)
      this.byKeyEntry.set(e.key, e)
      this.byKeyAccount.set(e.key, e.account)
      const arr = this.byBaseURL.get(e.baseURL)
      if (arr) {
        arr.push(e)
      } else {
        this.byBaseURL.set(e.baseURL, [e])
      }
    }
    for (const [baseURL, group] of this.byBaseURL) {
      const first = modelFingerprint(group[0].models)
      this.modelVariance.set(baseURL, group.some((e) => modelFingerprint(e.models) !== first))
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
   * 返回 key 在列表中的序号(用于日志脱敏)。未找到返回 -1。
   */
  keyIndex(key: string): number {
    return this.byKeyIndex.get(key) ?? -1
  }

  /**
   * 按 key 反查 provider 条目(http.response 用 Authorization 头识别 key 后取条目)。未找到返回 undefined。
   */
  entryByKey(key: string): ProviderEntry | undefined {
    return this.byKeyEntry.get(key)
  }

  /**
   * 返回 key 对应的账号名(用于日志)。未找到返回 "unknown"。
   */
  accountName(key: string): string {
    return this.byKeyAccount.get(key) ?? "unknown"
  }

  /**
   * 查找 URL 匹配的已配置 baseURL(用于提取路径前缀)。
   * 返回首个匹配的 baseURL,不匹配返回 null。
   */
  findBaseURL(url: string): string | null {
    for (const baseURL of this.byBaseURL.keys()) {
      if (url.startsWith(baseURL)) return baseURL
    }
    return null
  }

  /**
   * 该接入点内各条目的模型集是否存在差异。
   * 无差异时调用方可跳过请求体读取(模型不影响选池结果);未知 baseURL 保守返回 true(照常读 body)。
   */
  hasModelVariance(baseURL: string): boolean {
    return this.modelVariance.get(baseURL) ?? true
  }
}

/** 模型列表指纹:排序后 join,用于比较两个条目是否支持同一模型集 */
function modelFingerprint(models: string[]): string {
  return [...models].sort().join("|")
}
