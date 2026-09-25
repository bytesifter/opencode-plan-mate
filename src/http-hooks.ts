import type { ProviderPool } from "./pool"
import type { ProviderEntry } from "./types"

/** 429 冷却类型 */
export type CooldownType = "rate-limit" | "quota-exhausted"

/**
 * http 钩子的回调,用于日志等副作用。
 */
export interface HttpHookCallbacks {
  /** 收到响应后触发(429/402 已标记 cooldown 之后),含 provider 信息与耗时 */
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

/** 请求耗时记录:key 为 sessionID + kind,http.request 记起点,http.response 读取 */
const startTimes = new Map<string, number>()

/**
 * v2 `ctx.session.hook("http.request")` 处理器:按"接入点 + 模型"分组随机选 provider 并替换 Authorization。
 *
 * - URL 不匹配任何已配置 baseURL 或全熔断时 passthrough(不改请求)
 * - 同接入点轮询,baseURL 不变,仅替换 Authorization 头
 * - 请求 body 为一次性流,读取 model 前先 clone
 * - 选中后回调 onCorrelate(sessionID, account),供事件层 token 归因
 *
 * @param event - v2 钩子事件(SessionHttpRequest:含 sessionID/kind/request)
 * @param pool - provider 池
 * @param callbacks - 副作用回调
 */
export async function handleHttpRequest(
  event: {
    readonly sessionID: string
    readonly kind: string
    request: Request
  },
  pool: ProviderPool,
  callbacks?: HttpHookCallbacks,
): Promise<void> {
  const url = event.request.url
  const originalBaseURL = pool.findBaseURL(url)
  if (!originalBaseURL) return
  const model = await extractModel(event.request)
  const entry = pool.next(model, originalBaseURL)
  if (!entry) return
  const headers = new Headers(event.request.headers)
  headers.set("Authorization", `Bearer ${entry.key}`)
  event.request = new Request(event.request, { headers })
  startTimes.set(`${event.sessionID}:${event.kind}`, Date.now())
  callbacks?.onCorrelate?.(event.sessionID, entry.account)
}

/**
 * v2 `ctx.session.hook("http.response")` 处理器:检查 429/402 并标记熔断。
 *
 * - 通过 event.request 的 Authorization 头识别本次实际使用的 key(与 http.request 配对)
 * - 429 读取响应体分类(配额耗尽 vs 请求太快);402 无条件长熔断
 * - 读取响应体前先 clone,不消费原始 response
 *
 * @param event - v2 钩子事件(SessionHttpResponse:含 sessionID/kind/request/response)
 * @param pool - provider 池
 * @param callbacks - 副作用回调
 */
export async function handleHttpResponse(
  event: {
    readonly sessionID: string
    readonly kind: string
    readonly request: Request
    response: Response
  },
  pool: ProviderPool,
  callbacks?: HttpHookCallbacks,
): Promise<void> {
  const key = bearerKey(event.request.headers.get("Authorization"))
  if (!key) return
  const entry = pool.entryByKey(key)
  const status = event.response.status
  let cooldownType: CooldownType | undefined
  if (status === HTTP_TOO_MANY_REQUESTS) {
    cooldownType = await classify429(event.response)
    const ms = cooldownType === "quota-exhausted" ? pool.quotaCooldownMs : pool.cooldownMs
    pool.markCooldown(key, ms)
  } else if (status === HTTP_PAYMENT_REQUIRED) {
    cooldownType = "quota-exhausted"
    pool.markCooldown(key, pool.quotaCooldownMs)
  }
  if (entry) {
    const startKey = `${event.sessionID}:${event.kind}`
    const startMs = startTimes.get(startKey) ?? Date.now()
    startTimes.delete(startKey)
    callbacks?.onResponse?.(pool, entry, status, Date.now() - startMs, cooldownType)
  }
}

/**
 * 从 Authorization 头提取 bearer key(未命中返回 undefined)。
 */
export function bearerKey(auth: string | null): string | undefined {
  if (!auth) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(auth)
  return m ? m[1] : undefined
}

/**
 * 从请求 body 提取 model 字段。
 *
 * body 为 JSON 字符串时解析并返回 `model` 字段;否则返回 undefined(退化到同接入点池)。
 * body 为一次性流,读取前先 clone,避免消费原始流。
 */
export async function extractModel(request: Request): Promise<string | undefined> {
  let text: string
  try {
    const clone = request.clone()
    text = await clone.text()
  } catch {
    return undefined
  }
  if (!text.trim()) return undefined
  try {
    const parsed = JSON.parse(text) as { model?: unknown }
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
export async function classify429(response: Response): Promise<CooldownType> {
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
