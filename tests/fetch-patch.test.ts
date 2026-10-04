import { test, expect } from "bun:test"
import { installFetchPatch } from "../src/fetch-patch"
import { POOLED_MARKER_HEADER } from "../src/http-hooks"
import { ProviderPool } from "../src/pool"
import type { ProviderEntry } from "../src/types"
import type { CooldownType } from "../src/http-hooks"

function makePool(entries: ProviderEntry[], cooldownMs = 60000, quotaCooldownMs = 3600000): ProviderPool {
  return new ProviderPool(entries, cooldownMs, quotaCooldownMs)
}

/** 本地回显服务器:返回收到的 Authorization 与是否带兜底标记头 */
async function startEchoServer() {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(
        JSON.stringify({
          url: req.url,
          auth: req.headers.get("authorization"),
          marker: req.headers.get(POOLED_MARKER_HEADER),
        }),
        { headers: { "content-type": "application/json" } },
      )
    },
  })
  return server
}

/** 以服务器实际 URL 为 baseURL 构建池,保证 URL 匹配 */
function poolForServer(server: { port?: number }, entries: ProviderEntry[] = []): ProviderPool {
  const port = server.port ?? 0
  const base = `http://127.0.0.1:${port}`
  const list: ProviderEntry[] =
    entries.length > 0
      ? entries
      : [
          { key: "k1", baseURL: base, account: "account1", models: [] },
          { key: "k2", baseURL: base, account: "account2", models: [] },
        ]
  return makePool(list)
}

// ===== 2.1 兜底层:匹配池 URL 替换 key / 不匹配放行 / 全熔断 passthrough =====
test("2.1 匹配池 URL:兜底层替换 Authorization 为池 key", async () => {
  const server = await startEchoServer()
  const pool = poolForServer(server)
  const uninstall = installFetchPatch(pool)
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-session-id": "ses_drain" },
      body: JSON.stringify({ model: "deepseek-v4-flash" }),
    })
    const body = (await res.json()) as { auth: string; marker: string | null }
    expect(body.auth).toMatch(/^Bearer (k1|k2)$/)
  } finally {
    uninstall()
    server.stop(true)
  }
})

test("2.1 不匹配池 baseURL:原样放行不修改", async () => {
  const server = await startEchoServer()
  // 池 baseURL 指向另一个端口,请求打到 server 端口 → 不匹配
  const pool = makePool([
    { key: "k1", baseURL: "https://other.example/coding/v3", account: "account1", models: [] },
  ])
  const uninstall = installFetchPatch(pool)
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/other`, {
      headers: { authorization: "Bearer native-key" },
    })
    const body = (await res.json()) as { auth: string }
    expect(body.auth).toBe("Bearer native-key")
  } finally {
    uninstall()
    server.stop(true)
  }
})

test("2.1 全熔断:兜底 passthrough 原始 Authorization", async () => {
  const server = await startEchoServer()
  const pool = poolForServer(server)
  pool.markCooldown("k1", 60000)
  pool.markCooldown("k2", 60000)
  const uninstall = installFetchPatch(pool)
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`, {
      headers: { authorization: "Bearer native-key" },
    })
    const body = (await res.json()) as { auth: string }
    expect(body.auth).toBe("Bearer native-key")
  } finally {
    uninstall()
    server.stop(true)
  }
})

// ===== 2.2 双轨去重:钩子已拦(带标记头) → 兜底放行 =====
test("2.2 带兜底标记头的请求:兜底放行不重复轮询", async () => {
  const server = await startEchoServer()
  const pool = poolForServer(server)
  const uninstall = installFetchPatch(pool)
  try {
    // 模拟 session 钩子已处理:Authorization 已是池 key 且带标记头
    const res = await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`, {
      headers: {
        authorization: "Bearer k1",
        [POOLED_MARKER_HEADER]: "1",
      },
    })
    const body = (await res.json()) as { auth: string }
    expect(body.auth).toBe("Bearer k1") // 未被兜底再次轮询替换
  } finally {
    uninstall()
    server.stop(true)
  }
})

// ===== 2.4 兜底路径复用 onResponse/onCorrelate:429 分类熔断 =====
test("2.4 兜底路径 429 rate-limit:触发 onResponse 与熔断", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("rate limited", { status: 429 })
    },
  })
  const pool = poolForServer(server)
  const events: { status: number; cooldownType?: CooldownType }[] = []
  const uninstall = installFetchPatch(pool, {
    onResponse: (_p, _e, status, _d, cooldownType) => events.push({ status, cooldownType }),
  })
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`)
    expect(res.status).toBe(429)
    expect(events).toHaveLength(1)
    expect(events[0].status).toBe(429)
    expect(events[0].cooldownType).toBe("rate-limit")
    // 被选中的 provider 已被熔断
    const cooled = ["k1", "k2"].filter((k) => pool.isCoolingDown(k))
    expect(cooled).toHaveLength(1)
  } finally {
    uninstall()
    server.stop(true)
  }
})

test("2.4 兜底路径 429 quota-exhausted:长熔断", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        JSON.stringify({ error: { message: "You have exceeded the monthly usage quota." } }),
        { status: 429, headers: { "content-type": "application/json" } },
      )
    },
  })
  const pool = poolForServer(server)
  const events: { cooldownType?: CooldownType }[] = []
  const uninstall = installFetchPatch(pool, {
    onResponse: (_p, _e, _s, _d, cooldownType) => events.push({ cooldownType }),
  })
  try {
    await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`)
    expect(events[0].cooldownType).toBe("quota-exhausted")
    const cooled = ["k1", "k2"].filter((k) => pool.isCoolingDown(k))
    expect(cooled).toHaveLength(1)
  } finally {
    uninstall()
    server.stop(true)
  }
})

test("2.4 兜底路径 402:quota-exhausted 长熔断", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("Insufficient Balance", { status: 402 })
    },
  })
  const pool = poolForServer(server)
  const events: { cooldownType?: CooldownType }[] = []
  const uninstall = installFetchPatch(pool, {
    onResponse: (_p, _e, _s, _d, cooldownType) => events.push({ cooldownType }),
  })
  try {
    await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`)
    expect(events[0].cooldownType).toBe("quota-exhausted")
  } finally {
    uninstall()
    server.stop(true)
  }
})

test("2.4 兜底路径 onCorrelate:drain 请求按 x-opencode-session-id 建立关联", async () => {
  const server = await startEchoServer()
  const pool = poolForServer(server)
  const correlated: { sessionID: string; account: string }[] = []
  const uninstall = installFetchPatch(pool, {
    onCorrelate: (sessionID, account) => correlated.push({ sessionID, account }),
  })
  try {
    await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`, {
      headers: { "x-opencode-session-id": "ses_drain_1" },
    })
    expect(correlated).toHaveLength(1)
    expect(correlated[0].sessionID).toBe("ses_drain_1")
    expect(["account1", "account2"]).toContain(correlated[0].account)
  } finally {
    uninstall()
    server.stop(true)
  }
})

// ===== 3.1 在途计数:发出 +1 / 响应 -1 / 超时清零 =====
test("3.1 在途计数:acquire+1,release-1,下限 0", () => {
  const pool = makePool([
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  ])
  expect(pool.inflightCount("k1")).toBe(0)
  pool.acquire("k1")
  pool.acquire("k1")
  expect(pool.inflightCount("k1")).toBe(2)
  pool.release("k1")
  expect(pool.inflightCount("k1")).toBe(1)
  pool.release("k1")
  expect(pool.inflightCount("k1")).toBe(0)
  pool.release("k1") // 下限 0,不出现负数
  expect(pool.inflightCount("k1")).toBe(0)
})

test("3.1 在途超时清理:pruneInflight 清除过期计数", () => {
  const pool = makePool([
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
  ])
  pool.acquire("k1")
  expect(pool.inflightCount("k1")).toBe(1)
  const farFuture = Date.now() + 11 * 60 * 1000
  pool.pruneInflight(farFuture)
  expect(pool.inflightCount("k1")).toBe(0)
})

// ===== 3.2 least-loaded:优先 0 在途 / 同在途随机 =====
test("3.2 next 优先选 0 在途 provider", () => {
  const pool = makePool([
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
    { key: "k2", baseURL: "https://x.example/coding/v3", account: "account2", models: [] },
  ])
  pool.acquire("k1")
  // k1 有 1 在途,k2 为 0 → 必选 k2
  for (let i = 0; i < 20; i++) {
    expect(pool.next()?.key).toBe("k2")
  }
})

test("3.2 next 同在途数时随机(非熔断内)", () => {
  const pool = makePool([
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
    { key: "k2", baseURL: "https://x.example/coding/v3", account: "account2", models: [] },
  ])
  // 都在途 0 → 随机,40 次内两个 key 都应出现
  const seen = new Set<string>()
  for (let i = 0; i < 40; i++) {
    seen.add(pool.next()!.key)
  }
  expect(seen.size).toBe(2)
})

test("3.2 next 全 0 在途时行为与纯随机一致(兼容性)", () => {
  const pool = makePool([
    { key: "k1", baseURL: "https://x.example/coding/v3", account: "account1", models: [] },
    { key: "k2", baseURL: "https://x.example/coding/v3", account: "account2", models: [] },
  ])
  const counts: Record<string, number> = {}
  for (let i = 0; i < 200; i++) {
    const k = pool.next()!.key
    counts[k] = (counts[k] ?? 0) + 1
  }
  // 两个 key 都被选到且分布不极端(非熔断下 least-loaded 退化为随机)
  expect(counts["k1"]).toBeGreaterThan(0)
  expect(counts["k2"]).toBeGreaterThan(0)
})

// ===== 3.3 熔断共享:兜底路径熔断后,钩子路径 next 跳过 =====
test("3.3 兜底路径 429 熔断后,pool.next 跳过该 provider", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("rate limited", { status: 429 })
    },
  })
  const pool = poolForServer(server)
  const uninstall = installFetchPatch(pool)
  try {
    await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`)
    // 被熔断的 key 从 next 候选消失(下一次只会选另一个)
    const cooled = ["k1", "k2"].filter((k) => pool.isCoolingDown(k))
    expect(cooled).toHaveLength(1)
    const winner = pool.next()
    expect(winner?.key).not.toBe(cooled[0])
  } finally {
    uninstall()
    server.stop(true)
  }
})

// ===== 2.3 安装/卸载契约:setup 只装一次,卸载恢复原始 fetch =====
test("2.3 卸载后恢复原始 fetch:不再拦截", async () => {
  const server = await startEchoServer()
  const pool = poolForServer(server)
  const orig = globalThis.fetch
  const uninstall = installFetchPatch(pool)
  uninstall()
  // 卸载后 fetch 应回到原始引用
  expect(globalThis.fetch).toBe(orig)
  const res = await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`, {
    headers: { authorization: "Bearer native-key" },
  })
  const body = (await res.json()) as { auth: string }
  expect(body.auth).toBe("Bearer native-key") // 未被替换
  server.stop(true)
})

test("2.3 重复安装:后装链式包装先装(真实场景 setup 经模块单例守卫只装一次,不产生嵌套)", async () => {
  const server = await startEchoServer()
  const pool = poolForServer(server)
  const uninstall1 = installFetchPatch(pool)
  const uninstall2 = installFetchPatch(pool)
  // 两次安装同一池:链式包装后仍是同一池的 key
  const res = await fetch(`http://127.0.0.1:${server.port}/v3/chat/completions`)
  const body = (await res.json()) as { auth: string }
  expect(body.auth).toMatch(/^Bearer (k1|k2)$/)
  uninstall2()
  uninstall1()
  server.stop(true)
})
