import { test, expect } from "bun:test"
import {
  parseUsageLine,
  parseUsageLines,
  computeWindowSums,
  percentile,
  renderWindowTable,
  DEFAULT_WINDOW_MS,
} from "../src/tpm"

// ===== parseUsageLine =====
test("parseUsageLine:解析标准 usage 行", () => {
  const line =
    "2026-10-03 23:21:12.554 INFO  usage in=989 out=333 reasoning=0 cacheR=912896 cacheW=0 cost=0 session=ses_f249 provider=volhwy2410"
  const s = parseUsageLine(line)
  expect(s).toBeDefined()
  expect(s!.provider).toBe("volhwy2410")
  // tokens = in+out+reasoning+cacheR+cacheW
  expect(s!.tokens).toBe(989 + 333 + 0 + 912896 + 0)
  expect(s!.t).toBe(Date.parse("2026-10-03T23:21:12.000+08:00"))
})

test("parseUsageLine:非 usage 行返回 undefined", () => {
  expect(parseUsageLine("2026-10-03 23:21:12.554 INFO  fetch provider=a status=200 duration=1ms")).toBeUndefined()
  expect(parseUsageLine("not a log line")).toBeUndefined()
  expect(parseUsageLine("")).toBeUndefined()
})

test("parseUsageLine:无 provider 字段的 usage 行返回 undefined", () => {
  const line = "2026-10-03 23:21:12.554 INFO  usage in=1 out=2 reasoning=0 cacheR=0 cacheW=0 cost=0"
  expect(parseUsageLine(line)).toBeUndefined()
})

test("parseUsageLines:多行解析,跳过空行与坏行", () => {
  const lines = [
    "2026-10-03 23:21:12.554 INFO  usage in=100 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
    "",
    "garbage",
    "2026-10-03 23:21:13.554 INFO  usage in=200 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=b",
  ]
  const samples = parseUsageLines(lines)
  expect(samples).toHaveLength(2)
})

// ===== computeWindowSums =====
test("computeWindowSums:同窗口内 token 累计(60s 默认)", () => {
  const samples = parseUsageLines([
    "2026-10-03 23:00:00.000 INFO  usage in=1000 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
    "2026-10-03 23:00:30.000 INFO  usage in=2000 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
  ])
  const dist = computeWindowSums(samples)
  const sums = dist.get("a")!
  expect(sums).toHaveLength(2)
  expect(sums[0]).toBe(1000) // 第一条:窗口内只有自己
  expect(sums[1]).toBe(3000) // 第二条:窗口内两条之和
})

test("computeWindowSums:超出窗口的旧样本被滑出", () => {
  const samples = parseUsageLines([
    "2026-10-03 23:00:00.000 INFO  usage in=1000 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
    "2026-10-03 23:01:10.000 INFO  usage in=2000 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
  ])
  const dist = computeWindowSums(samples)
  const sums = dist.get("a")!
  // 第二条与第一条间隔 70s > 60s 窗口 → 只算自己
  expect(sums[1]).toBe(2000)
})

test("computeWindowSums:按 provider 分组互不影响", () => {
  const samples = parseUsageLines([
    "2026-10-03 23:00:00.000 INFO  usage in=1000 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
    "2026-10-03 23:00:30.000 INFO  usage in=500 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=b",
  ])
  const dist = computeWindowSums(samples)
  expect(dist.get("a")![0]).toBe(1000)
  expect(dist.get("b")![0]).toBe(500)
})

test("computeWindowSums:空输入返回空 Map", () => {
  const dist = computeWindowSums([])
  expect(dist.size).toBe(0)
})

test("computeWindowSums:自定义窗口毫秒", () => {
  const samples = parseUsageLines([
    "2026-10-03 23:00:00.000 INFO  usage in=1000 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
    "2026-10-03 23:00:30.000 INFO  usage in=2000 out=0 reasoning=0 cacheR=0 cacheW=0 cost=0 provider=a",
  ])
  const dist = computeWindowSums(samples, 10_000)
  // 10s 窗口:两条间隔 30s > 10s → 各自独立
  expect(dist.get("a")![1]).toBe(2000)
  expect(DEFAULT_WINDOW_MS).toBe(60_000)
})

// ===== percentile =====
test("percentile:p50/p90 计算(nearest-rank,floor 索引)", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  expect(percentile(sorted, 0.5)).toBe(6) // floor(10*0.5)=5 → 第 5 索引值
  expect(percentile(sorted, 0.9)).toBe(10) // floor(10*0.9)=9 → 第 9 索引值
  expect(percentile(sorted, 1)).toBe(10)
})

test("percentile:空数组返回 0", () => {
  expect(percentile([], 0.5)).toBe(0)
})

// ===== renderWindowTable =====
test("renderWindowTable:输出各账号 p50/p90/max", () => {
  const dist = new Map<string, number[]>([["volhwy2410", [100, 200, 300]]])
  const out = renderWindowTable(dist)
  expect(out).toContain("volhwy2410")
  expect(out).toContain("p50")
  expect(out).toContain("p90")
  expect(out).toContain("300") // max
})

test("renderWindowTable:空数据返回占位", () => {
  expect(renderWindowTable(new Map())).toBe("暂无 TPM 窗口数据")
})
