import { test, expect } from "bun:test"
import { parseOptions, collectProviders } from "../src/config"
import { homedir } from "node:os"

const fakeConfig = {
  provider: {
    "volxc9208": { options: { apiKey: "k1", baseURL: "https://x/coding/v3" }, models: { "glm-5.2": {}, "deepseek-v4-flash": {} } },
    "volxc5425": { options: { apiKey: "k3", baseURL: "https://x/coding/v3" }, models: { "glm-5.2": {} } },
    "vollqh5426": { options: { apiKey: "k2", baseURL: "https://x/coding/v3" } },
    "volxc9208-agentplan": { options: { apiKey: "k4", baseURL: "https://x/plan/v3" } },
  },
}

test("parseOptions: 缺 providers 抛错", () => {
  expect(() => parseOptions(undefined)).toThrow(/options/)
  expect(() => parseOptions({})).toThrow(/providers/)
  expect(() => parseOptions({ providers: [] })).toThrow(/providers/)
})

test("parseOptions: providers 元素非字符串抛错", () => {
  expect(() => parseOptions({ providers: ["ok", 123 as unknown] })).toThrow(/字符串/)
  expect(() => parseOptions({ providers: ["ok", ""] })).toThrow(/字符串/)
})

test("parseOptions: cooldownMs 默认 60000,可自定义", () => {
  const r = parseOptions({ providers: ["a"] })
  expect(r.cooldownMs).toBe(60000)
  const r2 = parseOptions({ providers: ["a"], cooldownMs: 30000 })
  expect(r2.cooldownMs).toBe(30000)
})

test("parseOptions: statsDir 与 logPath 可选", () => {
  const r = parseOptions({ providers: ["a"] })
  expect(r.statsDir).toBeUndefined()
  expect(r.logPath).toBeUndefined()
  const r2 = parseOptions({ providers: ["a"], statsDir: "/s", logPath: "/l.log" })
  expect(r2.statsDir).toBe("/s")
  expect(r2.logPath).toBe("/l.log")
})

test("parseOptions: logDir 可选,与 logPath 独立", () => {
  const r = parseOptions({ providers: ["a"] })
  expect(r.logDir).toBeUndefined()
  const r2 = parseOptions({ providers: ["a"], logDir: "/var/log/rr" })
  expect(r2.logDir).toBe("/var/log/rr")
  const r3 = parseOptions({ providers: ["a"], logDir: "/d", logPath: "/p.log" })
  expect(r3.logDir).toBe("/d")
  expect(r3.logPath).toBe("/p.log")
})

test("parseOptions: planStats.accounts 映射解析", () => {
  const r = parseOptions({ providers: ["a"] })
  expect(r.planStats).toBeUndefined()
  const r2 = parseOptions({ providers: ["a"], planStats: { accounts: { "账号A": "~/arkcli-a", "账号B": "/abs/b" } } })
  expect(r2.planStats?.accounts["账号A"]).toBe(homedir() + "/arkcli-a")
  expect(r2.planStats?.accounts["账号B"]).toBe("/abs/b")
  // 过滤 key/value 非法项
  const r3 = parseOptions({ providers: ["a"], planStats: { accounts: { "ok": "/x", "": "/y", "bad": "" } } })
  expect(Object.keys(r3.planStats?.accounts ?? {})).toEqual(["ok"])
  // 空映射/非对象 → 未配置
  const r4 = parseOptions({ providers: ["a"], planStats: { accounts: {} } })
  expect(r4.planStats).toBeUndefined()
  const r5 = parseOptions({ providers: ["a"], planStats: { accounts: "not-obj" as unknown } })
  expect(r5.planStats).toBeUndefined()
  // profiles 旧键不再生效
  const r6 = parseOptions({ providers: ["a"], planStats: { profiles: ["x"] } as unknown })
  expect(r6.planStats).toBeUndefined()
})

test("collectProviders: 返回扁平列表(不分组)", () => {
  const entries = collectProviders(fakeConfig, ["volxc9208", "volxc5425", "vollqh5426", "volxc9208-agentplan"])
  expect(entries).toHaveLength(4)
  expect(entries[0]).toEqual({ key: "k1", baseURL: "https://x/coding/v3", account: "volxc9208", models: ["glm-5.2", "deepseek-v4-flash"] })
  expect(entries[1]).toEqual({ key: "k3", baseURL: "https://x/coding/v3", account: "volxc5425", models: ["glm-5.2"] })
  expect(entries[2]).toEqual({ key: "k2", baseURL: "https://x/coding/v3", account: "vollqh5426", models: [] })
  expect(entries[3]).toEqual({ key: "k4", baseURL: "https://x/plan/v3", account: "volxc9208-agentplan", models: [] })
})

test("collectProviders: key 去重", () => {
  const cfg = {
    provider: {
      a: { options: { apiKey: "same", baseURL: "https://x" } },
      b: { options: { apiKey: "same", baseURL: "https://y" } },
    },
  }
  const entries = collectProviders(cfg, ["a", "b"])
  expect(entries).toHaveLength(1)
  expect(entries[0].key).toBe("same")
  expect(entries[0].account).toBe("a")
})

test("collectProviders: provider 名不存在抛错", () => {
  expect(() => collectProviders(fakeConfig, ["nope"])).toThrow(/不存在/)
})

test("collectProviders: 缺 baseURL 抛错", () => {
  const cfg = { provider: { a: { options: { apiKey: "k" } } } }
  expect(() => collectProviders(cfg, ["a"])).toThrow(/baseURL/)
})

test("collectProviders: 缺 apiKey 抛错", () => {
  const cfg = { provider: { a: { options: { baseURL: "https://x" } } } }
  expect(() => collectProviders(cfg, ["a"])).toThrow(/apiKey/)
})
