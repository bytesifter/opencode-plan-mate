import { test, expect, beforeEach, afterEach } from "bun:test"
import { patchFetch } from "../src/fetch-patch"
import { ProviderPool } from "../src/pool"
import type { ProviderEntry } from "../src/types"

let origFetch: typeof globalThis.fetch

beforeEach(() => {
  origFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = origFetch
})

function makePool(entries: ProviderEntry[], cooldownMs = 60000): ProviderPool {
  return new ProviderPool(entries, cooldownMs)
}

const codingEntries: ProviderEntry[] = [
  { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  { key: "k2", baseURL: "https://x.example/coding/v3", account: "account2", models: [] },
]

const mixedEntries: ProviderEntry[] = [
  { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  { key: "k2", baseURL: "https://x.example/plan/v3", account: "account2", models: [] },
]

test("URL 匹配:替换 Authorization 和 URL", async () => {
  let receivedUrl: string | null = null
  let receivedAuth: string | null = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    receivedUrl = typeof input === "string" ? input : input.toString()
    receivedAuth = new Headers(init?.headers).get("Authorization")
    return new Response("ok", { status: 200 })
  }) as unknown as typeof globalThis.fetch

  const unpatch = patchFetch(makePool(codingEntries))
  await fetch("https://x.example/coding/v3/chat/completions", {})
  unpatch()

  expect(receivedAuth).toMatch(/^Bearer (k1|k2)$/)
  expect(receivedUrl).toMatch(/^https:\/\/x\.example\/coding\/v3\/chat\/completions$/)
})

test("跨端点:coding 请求可能被路由到 plan baseURL", async () => {
  let receivedUrl = ""
  let receivedAuth = ""
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    receivedUrl = typeof input === "string" ? input : input.toString()
    receivedAuth = new Headers(init?.headers).get("Authorization") ?? ""
    return new Response("ok", { status: 200 })
  }) as unknown as typeof globalThis.fetch

  const urls: string[] = []
  const keys: string[] = []
  const unpatch = patchFetch(makePool(mixedEntries), {
    onResponse: (_pool, entry, _status, _duration) => {
      urls.push(entry.baseURL)
      keys.push(entry.key)
    },
  })
  for (let i = 0; i < 50; i++) {
    await fetch("https://x.example/coding/v3/chat/completions", {})
  }
  unpatch()

  // 两种 baseURL 都应出现
  expect(urls.some((u) => u.includes("coding"))).toBe(true)
  expect(urls.some((u) => u.includes("plan"))).toBe(true)
  // 请求 URL 应与选中的 baseURL 匹配
  expect(keys).toContain("k1")
  expect(keys).toContain("k2")
})

test("URL 不匹配任何 baseURL:passthrough", async () => {
  let receivedUrl = ""
  let receivedAuth: string | null = "sentinel"
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    receivedUrl = typeof input === "string" ? input : input.toString()
    receivedAuth = init?.headers ? new Headers(init.headers).get("Authorization") : null
    return new Response("ok", { status: 200 })
  }) as unknown as typeof globalThis.fetch

  const unpatch = patchFetch(makePool(codingEntries))
  await fetch("https://other.example/chat", {})
  unpatch()

  expect(receivedUrl).toBe("https://other.example/chat")
  expect(receivedAuth).toBeNull()
})

test("全部熔断:passthrough 原始请求", async () => {
  let receivedAuth: string | null = "sentinel"
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    receivedAuth = init?.headers ? new Headers(init.headers).get("Authorization") : null
    return new Response("ok", { status: 200 })
  }) as unknown as typeof globalThis.fetch

  const pool = makePool(codingEntries)
  pool.markCooldown("k1")
  pool.markCooldown("k2")
  const unpatch = patchFetch(pool)
  await fetch("https://x.example/coding/v3/chat/completions", {})
  unpatch()

  // passthrough:不设 Authorization
  expect(receivedAuth).toBeNull()
})

test("429 响应触发 markCooldown", async () => {
  const pool = makePool(codingEntries)
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof globalThis.fetch

  const unpatch = patchFetch(pool)
  for (let i = 0; i < 50; i++) {
    await fetch("https://x.example/coding/v3/chat/completions", {})
  }
  unpatch()

  expect(pool.isCoolingDown("k1") || pool.isCoolingDown("k2")).toBe(true)
})

test("onResponse 回调触发", async () => {
  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof globalThis.fetch

  const statuses: number[] = []
  const unpatch = patchFetch(makePool(codingEntries), {
    onResponse: (_pool, _entry, status, _duration) => statuses.push(status),
  })
  await fetch("https://x.example/coding/v3/chat/completions", {})
  unpatch()

  expect(statuses).toEqual([200])
})

test("unpatch 恢复原始 fetch", async () => {
  const mockFetch = (async () => new Response("mock")) as unknown as typeof globalThis.fetch
  globalThis.fetch = mockFetch

  const unpatch = patchFetch(makePool(codingEntries))
  unpatch()

  expect(globalThis.fetch).toBe(mockFetch)
})

test("配额耗尽 429 触发 quotaCooldownMs 熔断", async () => {
  const pool = new ProviderPool(codingEntries, 60000, 3600000)
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "You have exceeded the monthly usage quota. It will reset at 2026-08-05.",
        },
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof globalThis.fetch

  const types: string[] = []
  const unpatch = patchFetch(pool, {
    onResponse: (_pool, _entry, _status, _duration, cooldownType) => {
      if (cooldownType) types.push(cooldownType)
    },
  })
  await fetch("https://x.example/coding/v3/chat/completions", {})
  unpatch()

  expect(types).toContain("quota-exhausted")
  expect(pool.isCoolingDown("k1") || pool.isCoolingDown("k2")).toBe(true)
})

test("请求太快 429 触发 cooldownMs 熔断", async () => {
  const pool = new ProviderPool(codingEntries, 60000, 3600000)
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Requests are too frequent. Please reduce your request frequency.",
        },
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof globalThis.fetch

  const types: string[] = []
  const unpatch = patchFetch(pool, {
    onResponse: (_pool, _entry, _status, _duration, cooldownType) => {
      if (cooldownType) types.push(cooldownType)
    },
  })
  await fetch("https://x.example/coding/v3/chat/completions", {})
  unpatch()

  expect(types).toContain("rate-limit")
  expect(pool.isCoolingDown("k1") || pool.isCoolingDown("k2")).toBe(true)
})

test("响应体非 JSON 的 429 fallback 到 rate-limit", async () => {
  const pool = new ProviderPool(codingEntries, 60000, 3600000)
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof globalThis.fetch

  const types: string[] = []
  const unpatch = patchFetch(pool, {
    onResponse: (_pool, _entry, _status, _duration, cooldownType) => {
      if (cooldownType) types.push(cooldownType)
    },
  })
  await fetch("https://x.example/coding/v3/chat/completions", {})
  unpatch()

  expect(types).toContain("rate-limit")
})

test("X-Session-Id 读取 + onCorrelate 回调 + 删除头", async () => {
  let receivedSessionId: string | null = null
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    receivedSessionId = new Headers(init?.headers).get("X-Session-Id")
    return new Response("ok", { status: 200 })
  }) as unknown as typeof globalThis.fetch

  let correlated: { sessionID: string; account: string } | null = null
  const unpatch = patchFetch(makePool(codingEntries), {
    onCorrelate: (sessionID, account) => {
      correlated = { sessionID, account }
    },
  })
  await fetch("https://x.example/coding/v3/chat/completions", {
    headers: { "X-Session-Id": "ses_abc123" },
  })
  unpatch()

  expect(correlated).not.toBeNull()
  expect(correlated!.sessionID).toBe("ses_abc123")
  expect(["account1", "account2"]).toContain(correlated!.account)
  expect(receivedSessionId).toBeNull()
})

test("无 X-Session-Id 头时不回调", async () => {
  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof globalThis.fetch

  let correlated = false
  const unpatch = patchFetch(makePool(codingEntries), {
    onCorrelate: () => {
      correlated = true
    },
  })
  await fetch("https://x.example/coding/v3/chat/completions", {})
  unpatch()

  expect(correlated).toBe(false)
})

test("body 含 model 字段时按分组选 provider", async () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  const selectedAccounts: string[] = []
  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof globalThis.fetch

  const unpatch = patchFetch(pool, {
    onResponse: (_pool, entry, _status, _duration) => {
      selectedAccounts.push(entry.account)
    },
  })
  for (let i = 0; i < 20; i++) {
    await fetch("https://ark.example/coding/v3/chat/completions", {
      body: JSON.stringify({ model: "deepseek-v4-flash", messages: [] }),
    })
  }
  unpatch()

  expect(selectedAccounts.every((a) => a === "deepseek")).toBe(true)
})

test("body 不可解析时退化到扁平池", async () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  const selectedAccounts: string[] = []
  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof globalThis.fetch

  const unpatch = patchFetch(pool, {
    onResponse: (_pool, entry, _status, _duration) => {
      selectedAccounts.push(entry.account)
    },
  })
  for (let i = 0; i < 30; i++) {
    await fetch("https://ark.example/coding/v3/chat/completions", {})
  }
  unpatch()

  const uniqueAccounts = new Set(selectedAccounts)
  expect(uniqueAccounts.has("ark1")).toBe(true)
  expect(uniqueAccounts.has("deepseek")).toBe(true)
})
