import type { ProviderPool } from "./pool"
import type { ProviderEntry } from "./types"

/** 429 冷却类型 */
export type CooldownType = "rate-limit" | "quota-exhausted"

/**
 * fetch-patch 的回调,用于日志等副作用。
 */
export interface FetchPatchCallbacks {
  /** 收到响应后触发(429 已标记 cooldown 之后),含 provider 信息与耗时 */
  onResponse?: (
    pool: ProviderPool,
    entry: ProviderEntry,
    status: number,
    durationMs: number,
    cooldownType?: CooldownType,
  ) => void
  /** 建立 sessionID-provider 关联(选中 provider 后,请求发出前) */
  onCorrelate?: (sessionID: string, account: string) => void
}

/** 429 状态码:Too Many Requests,触发该 provider 熔断 */
const HTTP_TOO_MANY_REQUESTS = 429

/** 402 状态码:Payment Required(如 Insufficient Balance 余额不足),触发该 provider 长熔断 */
const HTTP_PAYMENT_REQUIRED = 402

/**
 * monkey-patch `globalThis.fetch`,随机选 provider 并替换 URL + Authorization。
 *
 * - 从所有 provider 中随机选一个(跳过熔断中的),替换请求 URL 和 Authorization 头
 * - 全部熔断或 URL 不匹配任何已配置 baseURL 时 passthrough
 * - 429/402 仅标记熔断,不在内部换 provider 重发
 *
 * @param pool - provider 池
 * @param callbacks - 响应回调(用于日志)
 * @returns unpatch 函数
 */
export function patchFetch(pool: ProviderPool, callbacks?: FetchPatchCallbacks): () => void {
  const origFetch = globalThis.fetch
  const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input)
    // 找到原始 baseURL,提取路径
    const originalBaseURL = pool.findBaseURL(url)
    if (!originalBaseURL) {
      // URL 不匹配任何已配置 baseURL:passthrough
      return origFetch(input, init)
    }
    const entry = pool.next(extractModel(init), originalBaseURL)
    if (!entry) {
      // 全熔断:passthrough 原始请求
      return origFetch(input, init)
    }
    // 替换 URL:去掉原始 baseURL 前缀,拼接到选中 provider 的 baseURL
    const path = url.slice(originalBaseURL.length)
    const newUrl = entry.baseURL + path
    const headers = new Headers(init?.headers)
    headers.set("Authorization", `Bearer ${entry.key}`)
    const sessionID = headers.get("X-Session-Id")
    if (sessionID) {
      headers.delete("X-Session-Id")
      callbacks?.onCorrelate?.(sessionID, entry.account)
    }
    const startMs = Date.now()
    const response = await origFetch(newUrl, { ...init, headers })
    const durationMs = Date.now() - startMs
    let cooldownType: CooldownType | undefined
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      cooldownType = await classify429(response)
      const ms = cooldownType === "quota-exhausted" ? pool.quotaCooldownMs : pool.cooldownMs
      pool.markCooldown(entry.key, ms)
    } else if (response.status === HTTP_PAYMENT_REQUIRED) {
      // 余额不足:不会自愈,按配额耗尽长时间冷却,不读响应体分类
      cooldownType = "quota-exhausted"
      pool.markCooldown(entry.key, pool.quotaCooldownMs)
    }
    callbacks?.onResponse?.(pool, entry, response.status, durationMs, cooldownType)
    return response
  }
  const origPreconnect = (origFetch as unknown as { preconnect?: (url: string | URL) => void }).preconnect
  if (typeof origPreconnect === "function") {
    ;(patchedFetch as unknown as { preconnect?: (url: string | URL) => void }).preconnect =
      origPreconnect.bind(origFetch)
  }
  globalThis.fetch = patchedFetch as unknown as typeof globalThis.fetch
  return () => {
    globalThis.fetch = origFetch
  }
}

/**
 * 从 fetch 入参解析 URL 字符串(兼容 string / URL / Request)。
 */
function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * 从 RequestInit.body 提取 model 字段。
 *
 * body 为 JSON 字符串时解析并返回 `model` 字段;否则返回 undefined(退化到扁平池)。
 */
function extractModel(init?: RequestInit): string | undefined {
  const body = init?.body
  if (typeof body !== "string") return undefined
  try {
    const parsed = JSON.parse(body) as { model?: unknown }
    return typeof parsed.model === "string" ? parsed.model : undefined
  } catch {
    return undefined
  }
}

/**
 * 读取 429 响应体判断冷却类型。
 *
 * - error.message 含 exceeded + quota -> quota-exhausted(配额耗尽)
 * - 其他(含解析失败) -> rate-limit(请求太快)
 *
 * 使用 response.clone() 读取副本,不消费原始 body。
 */
async function classify429(response: Response): Promise<CooldownType> {
  try {
    const clone = response.clone()
    const body = await clone.text()
    const parsed = JSON.parse(body)
    const message = String(parsed?.error?.message ?? "").toLowerCase()
    if (message.includes("exceeded") && message.includes("quota")) {
      return "quota-exhausted"
    }
  } catch {
    // 响应体不可读或非 JSON,fallback 到 rate-limit
  }
  return "rate-limit"
}
