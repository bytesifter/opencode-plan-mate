import { test, expect } from "bun:test"
import { ProviderPool } from "../src/pool"
import type { ProviderEntry } from "../src/types"

function makeEntries(count: number, baseURL = "https://x.example/api"): ProviderEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `k${i + 1}`,
    baseURL,
    account: `account${i + 1}`,
    models: [],
  }))
}

test("next() 返回列表中的 provider", () => {
  const pool = new ProviderPool(makeEntries(3), 60000)
  for (let i = 0; i < 50; i++) {
    const entry = pool.next()
    expect(entry).not.toBeNull()
    expect(["k1", "k2", "k3"]).toContain(entry!.key)
  }
})

test("随机性:多 provider 都会被选中", () => {
  const pool = new ProviderPool(makeEntries(3), 60000)
  const counts = { k1: 0, k2: 0, k3: 0 }
  for (let i = 0; i < 300; i++) {
    const e = pool.next()!
    counts[e.key as "k1" | "k2" | "k3"]++
  }
  expect(counts.k1).toBeGreaterThan(0)
  expect(counts.k2).toBeGreaterThan(0)
  expect(counts.k3).toBeGreaterThan(0)
})

test("429 标记 cooldown 后跳过该 provider", () => {
  const pool = new ProviderPool(makeEntries(3), 60000)
  pool.markCooldown("k1")
  for (let i = 0; i < 50; i++) {
    expect(pool.next()!.key).not.toBe("k1")
  }
})

test("cooldown 到期恢复可用", async () => {
  const pool = new ProviderPool(makeEntries(2), 50)
  pool.markCooldown("k1")
  expect(pool.isCoolingDown("k1")).toBe(true)
  await new Promise((r) => setTimeout(r, 70))
  expect(pool.isCoolingDown("k1")).toBe(false)
  let k1Selected = false
  for (let i = 0; i < 100; i++) {
    if (pool.next()!.key === "k1") k1Selected = true
  }
  expect(k1Selected).toBe(true)
})

test("全部熔断返回 null", () => {
  const pool = new ProviderPool(makeEntries(2), 60000)
  pool.markCooldown("k1")
  pool.markCooldown("k2")
  expect(pool.next()).toBeNull()
})

test("单 provider next() 返回该 provider", () => {
  const pool = new ProviderPool(makeEntries(1), 60000)
  expect(pool.next()!.key).toBe("k1")
})

test("单 provider 熔断后返回 null", () => {
  const pool = new ProviderPool(makeEntries(1), 60000)
  pool.markCooldown("k1")
  expect(pool.next()).toBeNull()
})

test("isCoolingDown 未标记的 key 返回 false", () => {
  const pool = new ProviderPool(makeEntries(2), 60000)
  expect(pool.isCoolingDown("k1")).toBe(false)
})

test("keyIndex 返回 key 在列表中的序号", () => {
  const pool = new ProviderPool(makeEntries(3), 60000)
  expect(pool.keyIndex("k1")).toBe(0)
  expect(pool.keyIndex("k2")).toBe(1)
  expect(pool.keyIndex("k3")).toBe(2)
  expect(pool.keyIndex("not-exist")).toBe(-1)
})

test("accountName 返回 key 对应的账号名", () => {
  const pool = new ProviderPool(makeEntries(2), 60000)
  expect(pool.accountName("k1")).toBe("account1")
  expect(pool.accountName("k2")).toBe("account2")
  expect(pool.accountName("not-exist")).toBe("unknown")
})

test("findBaseURL 返回匹配的 baseURL", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://host/coding/v3", account: "a1", models: [] },
    { key: "k2", baseURL: "https://host/plan/v3", account: "a2", models: [] },
  ]
  const pool = new ProviderPool(entries, 60000)
  expect(pool.findBaseURL("https://host/coding/v3/chat/completions")).toBe("https://host/coding/v3")
  expect(pool.findBaseURL("https://host/plan/v3/chat/completions")).toBe("https://host/plan/v3")
  expect(pool.findBaseURL("https://other.example/api")).toBeNull()
})

test("markCooldown(key, ms) 自定义时长覆盖默认 cooldownMs", async () => {
  const pool = new ProviderPool(makeEntries(2), 60000)
  pool.markCooldown("k1", 50)
  expect(pool.isCoolingDown("k1")).toBe(true)
  await new Promise((r) => setTimeout(r, 70))
  expect(pool.isCoolingDown("k1")).toBe(false)
})

test("同接入点+同模型分组:不跨接入点轮询", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2", "deepseek-v4-flash"] },
    { key: "k2", baseURL: "https://ark.example/coding/v3", account: "ark2", models: ["glm-5.2", "deepseek-v4-flash"] },
    { key: "k3", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)

  // 从 ARK 接入点发出的 deepseek-v4-flash 请求:只在 ARK 内轮
  const arkKeys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    arkKeys.add(pool.next("deepseek-v4-flash", "https://ark.example/coding/v3")!.key)
  }
  expect(arkKeys).toEqual(new Set(["k1", "k2"]))

  // 从 deepseek 接入点发出的 deepseek-v4-flash 请求:只在 deepseek 内轮
  const dsKeys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    dsKeys.add(pool.next("deepseek-v4-flash", "https://api.deepseek.com")!.key)
  }
  expect(dsKeys).toEqual(new Set(["k3"]))
})

test("同接入点内不同模型选择不同分组", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://ark.example/coding/v3", account: "ark2", models: ["glm-5.2", "deepseek-v4-flash"] },
    { key: "k3", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)

  const glmKeys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    glmKeys.add(pool.next("glm-5.2", "https://ark.example/coding/v3")!.key)
  }
  expect(glmKeys).toEqual(new Set(["k1", "k2"]))
})

test("model 无匹配时退化到同接入点池", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  const keys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    keys.add(pool.next("unknown-model", "https://ark.example/coding/v3")!.key)
  }
  expect(keys).toEqual(new Set(["k1"]))
})

test("无 model 参数时退化到同接入点池", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  const keys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    keys.add(pool.next(undefined, "https://ark.example/coding/v3")!.key)
  }
  expect(keys).toEqual(new Set(["k1"]))
})

test("originBaseURL 不在配置中时返回 null", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  expect(pool.next("glm-5.2", "https://unconfigured.example/api")).toBeNull()
})

test("同接入点分组全熔断时返回 null(不跨接入点兜底)", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["deepseek-v4-flash"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  pool.markCooldown("k1")
  for (let i = 0; i < 100; i++) {
    expect(pool.next("deepseek-v4-flash", "https://ark.example/coding/v3")).toBeNull()
  }
})
