import { test, expect } from "bun:test"
import { renderChart } from "../src/chart"
import type { StatsStore } from "../src/types"

function makeStore(): StatsStore {
  return {
    "2026-07-25": {
      "account-a": { req: 34, in: 10000, out: 8000, reasoning: 1000, cacheRead: 500, cacheWrite: 200, cost: 0.5 },
      "account-b": { req: 23, in: 8000, out: 6000, reasoning: 800, cacheRead: 400, cacheWrite: 100, cost: 0.3 },
    },
    "2026-07-24": {
      "account-a": { req: 20, in: 6000, out: 4000, reasoning: 500, cacheRead: 300, cacheWrite: 150, cost: 0.2 },
    },
    "2026-07-23": {
      "account-b": { req: 67, in: 20000, out: 15000, reasoning: 2000, cacheRead: 1000, cacheWrite: 300, cost: 1.2 },
    },
  }
}

test("无数据返回提示", () => {
  expect(renderChart({})).toBe("暂无统计数据")
})

test("默认近 7 天", () => {
  const out = renderChart(makeStore())
  expect(out).toContain("近 7 天")
  expect(out).toContain("07-25")
  expect(out).toContain("07-24")
  expect(out).toContain("07-23")
})

test("days 参数控制天数", () => {
  const out = renderChart(makeStore(), 2)
  expect(out).toContain("近 2 天")
  expect(out).toContain("07-25")
  expect(out).toContain("07-24")
  expect(out).not.toContain("07-23")
})

test("图表含 per-provider 信息", () => {
  const out = renderChart(makeStore())
  expect(out).toContain("account-a")
  expect(out).toContain("account-b")
  expect(out).toContain("token")
  expect(out).toContain("█")
})

test("图表含合计行", () => {
  const out = renderChart(makeStore())
  expect(out).toContain("合计")
  expect(out).toContain("请求=54")
  expect(out).toContain("请求=90")
})

test("单条数据也能正常渲染", () => {
  const store: StatsStore = {
    "2026-07-25": {
      "account-a": { req: 5, in: 1000, out: 500, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    },
  }
  const out = renderChart(store)
  expect(out).toContain("07-25")
  expect(out).toContain("account-a")
  expect(out).toContain("5")
})
