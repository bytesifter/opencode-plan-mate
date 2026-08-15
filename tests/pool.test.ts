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

test("按模型分组选择:同模型跨 baseURL", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2", "deepseek-v4-flash"] },
    { key: "k2", baseURL: "https://ark.example/coding/v3", account: "ark2", models: ["glm-5.2", "deepseek-v4-flash"] },
    { key: "k3", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  expect(pool.hasGroup("glm-5.2")).toBe(true)
  expect(pool.hasGroup("deepseek-v4-flash")).toBe(true)
  expect(pool.hasGroup("unknown-model")).toBe(false)

  const glmKeys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    glmKeys.add(pool.next("glm-5.2")!.key)
  }
  expect(glmKeys).toEqual(new Set(["k1", "k2"]))

  const dsKeys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    dsKeys.add(pool.next("deepseek-v4-flash")!.key)
  }
  expect(dsKeys).toEqual(new Set(["k1", "k2", "k3"]))
})

test("model 无分组时退化到扁平池", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  const keys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    keys.add(pool.next("unknown-model")!.key)
  }
  expect(keys).toEqual(new Set(["k1", "k2"]))
})

test("无 model 参数时退化到扁平池", () => {
  const entries: ProviderEntry[] = [
    { key: "k1", baseURL: "https://ark.example/coding/v3", account: "ark1", models: ["glm-5.2"] },
    { key: "k2", baseURL: "https://api.deepseek.com", account: "deepseek", models: ["deepseek-v4-flash"] },
  ]
  const pool = new ProviderPool(entries, 60000)
  const keys = new Set<string>()
  for (let i = 0; i < 100; i++) {
    keys.add(pool.next()!.key)
  }
  expect(keys).toEqual(new Set(["k1", "k2"]))
})
