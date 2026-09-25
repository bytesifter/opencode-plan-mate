import { test, expect } from "bun:test"
import { handleHttpRequest, handleHttpResponse, classify429, bearerKey, pruneStartTimes } from "../src/http-hooks"
import { ProviderPool } from "../src/pool"
import type { ProviderEntry } from "../src/types"
import type { CooldownType } from "../src/http-hooks"

function makePool(entries: ProviderEntry[], cooldownMs = 60000, quotaCooldownMs?: number): ProviderPool {
  return new ProviderPool(entries, cooldownMs, quotaCooldownMs)
}

const codingEntries: ProviderEntry[] = [
  { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  { key: "k2", baseURL: "https://x.example/coding/v3", account: "account2", models: [] },
]

const mixedEntries: ProviderEntry[] = [
  { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  { key: "k2", baseURL: "https://x.example/plan/v3", account: "account2", models: [] },
]

// ===== http.request:替换 Authorization =====
test("URL 匹配:替换 Authorization,URL 不变", async () => {
  const req = new Request("https://x.example/coding/v3/chat/completions")
  const event = { sessionID: "ses_1", kind: "primary", request: req }
  await handleHttpRequest(event, makePool(codingEntries))
  const auth = event.request.headers.get("Authorization")
  expect(auth).toMatch(/^Bearer (k1|k2)$/)
  expect(event.request.url).toBe("https://x.example/coding/v3/chat/completions")
})

test("同接入点内轮询:coding 请求不路由到 plan baseURL", async () => {
  const pool = makePool(mixedEntries)
  const accounts = new Set<string>()
  for (let i = 0; i < 50; i++) {
    const event = { sessionID: `ses_${i}`, kind: "primary", request: new Request("https://x.example/coding/v3/chat/completions") }
    await handleHttpRequest(event, pool, {
      onCorrelate: (_s, account) => accounts.add(account),
    })
  }
  // 只应在 coding 接入点内轮询,不跨到 plan 接入点
  expect([...accounts].every((a) => a === "account1")).toBe(true)
})

test("URL 不匹配任何 baseURL:passthrough", async () => {
  const req = new Request("https://other.example/chat")
  const event = { sessionID: "ses_1", kind: "primary", request: req }
  await handleHttpRequest(event, makePool(codingEntries))
  expect(event.request.headers.get("Authorization")).toBeNull()
})

test("全部熔断:passthrough 原始请求", async () => {
  const pool = makePool(codingEntries)
  pool.markCooldown("k1")
  pool.markCooldown("k2")
  const req = new Request("https://x.example/coding/v3/chat/completions")
  const event = { sessionID: "ses_1", kind: "primary", request: req }
  await handleHttpRequest(event, pool)
  expect(event.request.headers.get("Authorization")).toBeNull()
})

// ===== 关联映射(sessionID 直取,无需 X-Session-Id 头)=====
test("onCorrelate 用钩子自带的 sessionID 建立关联", async () => {
  const correlated: { sessionID: string; account: string }[] = []
  const event = { sessionID: "ses_abc", kind: "primary", request: new Request("https://x.example/coding/v3/chat/completions") }
  await handleHttpRequest(event, makePool(codingEntries), {
    onCorrelate: (sessionID, account) => correlated.push({ sessionID, account }),
  })
  expect(correlated).toHaveLength(1)
  expect(correlated[0].sessionID).toBe("ses_abc")
  expect(["account1", "account2"]).toContain(correlated[0].account)
})

// ===== body 模型分组 =====
test("body 含 model 时按接入点分组选 provider(不跨接入点)", async () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = makePool(entries)
  const accounts = new Set<string>()
  for (let i = 0; i < 20; i++) {
    const event = {
      sessionID: `ses_${i}`,
      kind: "primary",
      request: new Request("https://ark.example/coding/v3/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "deepseek-v4-flash", messages: [] }),
      }),
    }
    await handleHttpRequest(event, pool, {
      onCorrelate: (_s, account) => accounts.add(account),
    })
  }
  // 请求从 ARK 端点发出:即使 deepseek 端点支持该 model,也不跨接入点,退化到 ARK 接入点池
  expect([...accounts].every((a) => a === "ark1")).toBe(true)
})

test("body 不可解析时退化到同接入点池", async () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = makePool(entries)
  const accounts = new Set<string>()
  for (let i = 0; i < 30; i++) {
    const event = { sessionID: `ses_${i}`, kind: "primary", request: new Request("https://ark.example/coding/v3/chat/completions") }
    await handleHttpRequest(event, pool, {
      onCorrelate: (_s, account) => accounts.add(account),
    })
  }
  expect([...accounts].every((a) => a === "ark1")).toBe(true)
})

test("body 是空串时退化到同接入点池", async () => {
  const pool = makePool(codingEntries)
  const event = {
    sessionID: "ses_1",
    kind: "primary",
    request: new Request("https://x.example/coding/v3/chat/completions", { method: "POST", body: "" }),
  }
  await handleHttpRequest(event, pool)
  expect(event.request.headers.get("Authorization")).toMatch(/^Bearer (k1|k2)$/)
})

// ===== extractModel 守卫:模型集一致跳过请求体读取 =====
test("模型集一致:跳过请求体读取,仍选中 provider", async () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://x.example/coding/v3", account: "account2", models: ["glm-5.2"] },
  ]
  const pool = makePool(entries)
  let extractCalls = 0
  const event = {
    sessionID: "ses_1",
    kind: "primary",
    request: new Request("https://x.example/coding/v3/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "glm-5.2", messages: [] }),
    }),
  }
  await handleHttpRequest(event, pool, {
    extractModel: async () => {
      extractCalls++
      return "glm-5.2"
    },
  })
  expect(event.request.headers.get("Authorization")).toMatch(/^Bearer (k1|k2)$/)
  expect(extractCalls).toBe(0)
})

test("模型集有差异:仍读取请求体提取 model", async () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://x.example/coding/v3", account: "account2", models: ["glm-5.2", "deepseek-v4-flash"] },
  ]
  const pool = makePool(entries)
  let extractCalls = 0
  const event = {
    sessionID: "ses_1",
    kind: "primary",
    request: new Request("https://x.example/coding/v3/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "glm-5.2", messages: [] }),
    }),
  }
  await handleHttpRequest(event, pool, {
    extractModel: async () => {
      extractCalls++
      return "glm-5.2"
    },
  })
  expect(event.request.headers.get("Authorization")).toMatch(/^Bearer (k1|k2)$/)
  expect(extractCalls).toBe(1)
})

// ===== http.response:429/402 熔断 =====
function responseEvent(authKey: string, response: Response) {
  return {
    sessionID: "ses_1",
    kind: "primary",
    request: new Request("https://x.example/coding/v3/chat/completions", {
      headers: { Authorization: `Bearer ${authKey}` },
    }),
    response,
  }
}

test("429 响应触发 markCooldown", async () => {
  const pool = makePool(codingEntries)
  const types: CooldownType[] = []
  await handleHttpResponse(
    responseEvent("k1", new Response("rate limited", { status: 429 })),
    pool,
    { onResponse: (_pool, _entry, _status, _duration, t) => { if (t) types.push(t) } },
  )
  expect(types).toEqual(["rate-limit"])
  expect(pool.isCoolingDown("k1")).toBe(true)
})

test("配额耗尽 429 触发 quotaCooldownMs 熔断", async () => {
  const pool = makePool(codingEntries, 60000, 3600000)
  const types: CooldownType[] = []
  await handleHttpResponse(
    responseEvent(
      "k1",
      new Response(
        JSON.stringify({ error: { message: "You have exceeded the monthly usage quota." } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    ),
    pool,
    { onResponse: (_pool, _entry, _status, _duration, t) => { if (t) types.push(t) } },
  )
  expect(types).toEqual(["quota-exhausted"])
  expect(pool.isCoolingDown("k1")).toBe(true)
})

test("请求太快 429 触发 cooldownMs 熔断", async () => {
  const pool = makePool(codingEntries, 60000, 3600000)
  const types: CooldownType[] = []
  await handleHttpResponse(
    responseEvent(
      "k1",
      new Response(
        JSON.stringify({ error: { message: "Requests are too frequent." } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    ),
    pool,
    { onResponse: (_pool, _entry, _status, _duration, t) => { if (t) types.push(t) } },
  )
  expect(types).toEqual(["rate-limit"])
  expect(pool.isCoolingDown("k1")).toBe(true)
})

test("响应体非 JSON 的 429 fallback 到 rate-limit", async () => {
  const pool = makePool(codingEntries)
  const types: CooldownType[] = []
  await handleHttpResponse(
    responseEvent("k1", new Response("rate limited", { status: 429 })),
    pool,
    { onResponse: (_pool, _entry, _status, _duration, t) => { if (t) types.push(t) } },
  )
  expect(types).toEqual(["rate-limit"])
})

test("402 响应归为 quota-exhausted 并标记熔断", async () => {
  const pool = makePool(codingEntries, 60000, 3600000)
  const types: CooldownType[] = []
  await handleHttpResponse(
    responseEvent("k1", new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 })),
    pool,
    { onResponse: (_pool, _entry, _status, _duration, t) => { if (t) types.push(t) } },
  )
  expect(types).toEqual(["quota-exhausted"])
  expect(pool.isCoolingDown("k1")).toBe(true)
})

test("402 冷却时长使用 quotaCooldownMs 而非 cooldownMs", async () => {
  const singleEntry: ProviderEntry[] = [
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  ]
  const pool = makePool(singleEntry, 60000, 500)
  await handleHttpResponse(
    responseEvent("k1", new Response("Insufficient Balance", { status: 402 })),
    pool,
  )
  const now = Date.now()
  expect(pool.isCoolingDown("k1", now)).toBe(true)
  expect(pool.isCoolingDown("k1", now + 1000)).toBe(false)
})

test("未配 quotaCooldownMs 时 402 使用默认 3600000ms 长冷却", async () => {
  const singleEntry: ProviderEntry[] = [
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  ]
  const pool = makePool(singleEntry, 60000)
  await handleHttpResponse(
    responseEvent("k1", new Response("Insufficient Balance", { status: 402 })),
    pool,
  )
  const now = Date.now()
  expect(pool.isCoolingDown("k1", now + 61000)).toBe(true)
})

test("onResponse 回调触发(200)", async () => {
  const pool = makePool(codingEntries)
  const statuses: number[] = []
  await handleHttpResponse(
    responseEvent("k1", new Response("ok", { status: 200 })),
    pool,
    { onResponse: (_pool, _entry, status) => statuses.push(status) },
  )
  expect(statuses).toEqual([200])
})

test("无 Authorization 头的响应不触发熔断", async () => {
  const pool = makePool(codingEntries)
  await handleHttpResponse({
    sessionID: "ses_1",
    kind: "primary",
    request: new Request("https://x.example/coding/v3/chat/completions"),
    response: new Response("rate limited", { status: 429 }),
  }, pool)
  expect(pool.isCoolingDown("k1")).toBe(false)
  expect(pool.isCoolingDown("k2")).toBe(false)
})

// ===== 纯函数 =====
test("bearerKey 提取", () => {
  expect(bearerKey("Bearer abc123")).toBe("abc123")
  expect(bearerKey(null)).toBeUndefined()
  expect(bearerKey("Basic xyz")).toBeUndefined()
})

test("classify429:exceeded+quota 归 quota-exhausted", async () => {
  const r = new Response(JSON.stringify({ error: { message: "You have exceeded the usage quota" } }), { status: 429 })
  expect(await classify429(r)).toBe("quota-exhausted")
})

test("classify429:其他归 rate-limit", async () => {
  expect(await classify429(new Response("plain", { status: 429 }))).toBe("rate-limit")
  expect(await classify429(new Response(JSON.stringify({ error: { message: "too fast" } }), { status: 429 }))).toBe("rate-limit")
})

// ===== startTimes 泄漏修复 =====
test("startTimes:响应 key 不匹配池时条目仍被清理", async () => {
  const pool = makePool(codingEntries)
  const req = new Request("https://x.example/coding/v3/chat/completions")
  await handleHttpRequest({ sessionID: "ses_1", kind: "primary", request: req }, pool)
  await new Promise((r) => setTimeout(r, 30))
  // 池外 key 的响应:entry miss,不触发 onResponse,但应清理 startTimes
  await handleHttpResponse(responseEvent("outside-key", new Response("ok", { status: 200 })), pool)
  // 同 sessionID:kind 的池内响应:若条目已清理,duration≈0;未清理则≥30ms
  let dur = -1
  await handleHttpResponse(responseEvent("k1", new Response("ok", { status: 200 })), pool, {
    onResponse: (_p, _e, _s, d) => {
      dur = d
    },
  })
  expect(dur).toBeGreaterThanOrEqual(0)
  expect(dur).toBeLessThan(25)
})

test("pruneStartTimes:超时条目被清理,新条目与边界条目保留", () => {
  const now = Date.now()
  const m = new Map<string, number>([
    ["stale:primary", now - 11 * 60 * 1000],
    ["fresh:primary", now - 1000],
    ["boundary:primary", now - 10 * 60 * 1000],
  ])
  pruneStartTimes(m, now)
  expect(m.has("stale:primary")).toBe(false)
  expect(m.has("fresh:primary")).toBe(true)
  // 恰好等于阈值:未超过,保留
  expect(m.has("boundary:primary")).toBe(true)
})
