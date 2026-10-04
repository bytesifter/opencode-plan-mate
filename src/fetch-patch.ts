import type { ProviderPool } from "./pool"
import type { ProviderEntry } from "./types"
import { classify429, POOLED_MARKER_HEADER, type CooldownType } from "./http-hooks"

/** 429 状态码:Too Many Requests */
const HTTP_TOO_MANY_REQUESTS = 429

/** 402 状态码:Payment Required */
const HTTP_PAYMENT_REQUIRED = 402

/**
 * 兜底路径回调(与 session 钩子路径共用,保证熔断/统计一致)。
 */
export interface FetchPatchCallbacks {
  /** 响应后触发(429/402 已标记 cooldown 之后),与钩子路径 onResponse 同语义 */
  onResponse?: (
    pool: ProviderPool,
    entry: ProviderEntry,
    status: number,
    durationMs: number,
    cooldownType?: CooldownType,
  ) => void
  /** 建立 sessionID-provider 关联(drain 请求带 x-opencode-session-id 头时) */
  onCorrelate?: (sessionID: string, account: string) => void
}

/**
 * 合并 input(Request) 与 init.headers 的请求头。
 * AI SDK 可能以 `fetch(requestObject)` 或 `fetch(url, {headers})` 两种形态调用,
 * 统一合并以避免漏读/误读标记头。
 */
function mergeHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const merged = new Headers()
  if (input instanceof Request) {
    for (const [k, v] of input.headers.entries()) merged.set(k, v)
  }
  if (init?.headers) {
    const hs = new Headers(init.headers)
    for (const [k, v] of hs.entries()) merged.set(k, v)
  }
  return merged
}

/**
 * 以替换后的 headers 重建请求参数(保持 input/init 原形态),并更新合并后的 headers。
 * 返回 [newInput, newInit]:两者之一可能与原值不同,均需传给原始 fetch。
 */
function rebuildWithHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  headers: Headers,
): [RequestInfo | URL, RequestInit | undefined] {
  const newHeaders = headers
  if (input instanceof Request) {
    return [new Request(input, { headers: newHeaders }), init]
  }
  return [input, { ...init, headers: newHeaders }]
}

/**
 * 安装全局 fetch 兜底层:patch `globalThis.fetch`,拦截走全局 fetch 但未被
 * `session.hook("http.request")` 拦截的、URL 匹配池 baseURL 的请求
 * (典型如 opencode core 层会话恢复/drain 路径),纳入与钩子路径相同的 key 轮询
 * 与 429/402 熔断。
 *
 * 设计要点:
 * - 保存原始 fetch 引用,转发用原始 fetch 执行;返回卸载函数恢复
 * - 仅替换 Authorization 头,不改 URL/方法/body;SSE 流式响应原样透传
 * - 双轨去重:请求带 POOLED_MARKER_HEADER(钩子已拦)即放行,不重复轮询
 * - 全熔断 / 不匹配池 baseURL 时原样放行
 * - 兜底路径自己处理响应:429/402 分类熔断 + onResponse 回调(钩子路径的
 *   http.response 钩子不会为 drain 请求触发,故在此补齐)
 * - 在途计数:拦截并转发前 acquire,响应后 release
 *
 * @param pool - 共享的 ProviderPool(session 钩子与兜底路径同一实例)
 * @param callbacks - 与钩子路径共用的回调(onResponse/onCorrelate)
 * @returns 卸载函数:恢复原始 fetch
 */
export function installFetchPatch(pool: ProviderPool, callbacks?: FetchPatchCallbacks): () => void {
  const origFetch = globalThis.fetch

  const patched = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const originalBaseURL = pool.findBaseURL(url)
    if (!originalBaseURL) return origFetch(input, init)

    const headers = mergeHeaders(input, init)
    // 双轨去重:session 钩子已处理过的请求带标记头,放行不重复轮询
    if (headers.has(POOLED_MARKER_HEADER)) {
      return origFetch(input, init)
    }

    const entry = pool.next(undefined, originalBaseURL)
    if (!entry) return origFetch(input, init)

    headers.set("Authorization", `Bearer ${entry.key}`)
    pool.acquire(entry.key)
    const start = Date.now()
    // session 归因:drain 请求带 x-opencode-session-id 头,借此建立关联
    const sessionID = headers.get("x-opencode-session-id")
    if (sessionID) callbacks?.onCorrelate?.(sessionID, entry.account)
    const [newInput, newInit] = rebuildWithHeaders(input, init, headers)
    try {
      const response = await origFetch(newInput, newInit)
      const durationMs = Date.now() - start
      let cooldownType: CooldownType | undefined
      if (response.status === HTTP_TOO_MANY_REQUESTS) {
        cooldownType = await classify429(response)
        const ms = cooldownType === "quota-exhausted" ? pool.quotaCooldownMs : pool.cooldownMs
        pool.markCooldown(entry.key, ms)
      } else if (response.status === HTTP_PAYMENT_REQUIRED) {
        cooldownType = "quota-exhausted"
        pool.markCooldown(entry.key, pool.quotaCooldownMs)
      }
      callbacks?.onResponse?.(pool, entry, response.status, durationMs, cooldownType)
      return response
    } finally {
      pool.release(entry.key)
    }
  }

  globalThis.fetch = patched as typeof fetch
  return () => {
    globalThis.fetch = origFetch
  }
}
