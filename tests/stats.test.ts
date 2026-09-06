import { test, expect, beforeEach, afterEach } from "bun:test"
import { StatsCollector, aggregateStats, todayLocal, type UsageInput } from "../src/stats"
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

const tmpDir = join(import.meta.dir, ".tmp-stats")
const statsDir = join(tmpDir, "stats")

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeCollector() {
  return new StatsCollector(statsDir, { registerExitHooks: false })
}

function tok(in_: number, out: number, reasoning = 0, cacheRead = 0, cacheWrite = 0) {
  return { input: in_, output: out, reasoning, cache: { read: cacheRead, write: cacheWrite } }
}

test("带 tokens 累计所有字段到指定 provider", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", role: "assistant", finish: "stop", tokens: tok(100, 50, 10, 5, 3), cost: 0.02 },
    "account-a",
  )
  c.recordUsage(
    { id: "msg-2", role: "assistant", finish: "stop", tokens: tok(200, 80, 20, 8, 2), cost: 0.05 },
    "account-b",
  )
  const day = c.getStore()[todayLocal()]
  expect(day["account-a"].req).toBe(1)
  expect(day["account-a"].in).toBe(100)
  expect(day["account-a"].out).toBe(50)
  expect(day["account-b"].req).toBe(1)
  expect(day["account-b"].in).toBe(200)
  expect(day["account-b"].cost).toBeCloseTo(0.05)
})

test("无 tokens 忽略", () => {
  const c = makeCollector()
  c.recordUsage({ id: "msg-1", role: "assistant", finish: "stop" }, "account-a")
  expect(c.getStore()[todayLocal()]).toBeUndefined()
})

test("按本地日期 YYYY-MM-DD 分组", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", role: "assistant", finish: "stop", tokens: tok(1, 1) },
    "account-a",
  )
  const day = todayLocal()
  expect(c.getStore()[day]).toBeDefined()
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test("flush 追加写入 JSONL 且 aggregateStats 读回", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", role: "assistant", finish: "stop", tokens: tok(10, 5) },
    "account-a",
  )
  c.flush()
  const file = join(statsDir, `${todayLocal()}.jsonl`)
  expect(existsSync(file)).toBe(true)

  const store = aggregateStats(statsDir, 1)
  expect(store[todayLocal()]["account-a"].req).toBe(1)
  expect(store[todayLocal()]["account-a"].in).toBe(10)
})

test("目录不存在时构造不报错,store 为空", () => {
  const c = new StatsCollector(join(tmpDir, "noexist"), { registerExitHooks: false })
  expect(c.getStore()).toEqual({})
})

test("多步对话:同 id 两步不同 token 均累加,req=2", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", finish: "tool-calls", tokens: tok(1000, 50) },
    "account-a",
  )
  c.recordUsage(
    { id: "msg-1", finish: "stop", tokens: tok(3000, 500) },
    "account-b",
  )
  const day = c.getStore()[todayLocal()]
  expect(day["account-a"].req).toBe(1)
  expect(day["account-a"].in).toBe(1000)
  expect(day["account-b"].req).toBe(1)
  expect(day["account-b"].in).toBe(3000)
})

test("相同 token 快照 re-emission 跳过", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", finish: "stop", tokens: tok(100, 500) },
    "account-a",
  )
  const ret = c.recordUsage(
    { id: "msg-1", finish: "stop", tokens: tok(100, 500) },
    "account-a",
  )
  expect(ret).toBe(false)
  const day = c.getStore()[todayLocal()]
  expect(day["account-a"].req).toBe(1)
  expect(day["account-a"].out).toBe(500)
})

test("per-provider 归因:不同 provider 分别累加", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", finish: "stop", tokens: tok(100, 50) },
    "account-a",
  )
  c.recordUsage(
    { id: "msg-2", finish: "stop", tokens: tok(200, 80) },
    "account-b",
  )
  c.recordUsage(
    { id: "msg-3", finish: "stop", tokens: tok(150, 60) },
    "account-a",
  )
  const day = c.getStore()[todayLocal()]
  expect(day["account-a"].req).toBe(2)
  expect(day["account-a"].in).toBe(250)
  expect(day["account-b"].req).toBe(1)
  expect(day["account-b"].in).toBe(200)
})

test("多进程模拟:两个 collector 追加到同一目录,聚合求和", () => {
  const a = makeCollector()
  const b = makeCollector()
  a.recordUsage({ id: "msg-a1", finish: "stop", tokens: tok(100, 50) }, "account-a")
  b.recordUsage({ id: "msg-b1", finish: "stop", tokens: tok(200, 80) }, "account-b")
  a.flush()
  b.flush()

  const store = aggregateStats(statsDir, 1)
  expect(store[todayLocal()]["account-a"].req).toBe(1)
  expect(store[todayLocal()]["account-a"].in).toBe(100)
  expect(store[todayLocal()]["account-b"].req).toBe(1)
  expect(store[todayLocal()]["account-b"].in).toBe(200)
})

test("同一 provider 多窗口增量聚合为累计", () => {
  const c = makeCollector()
  c.recordUsage({ id: "msg-1", finish: "stop", tokens: tok(100, 50) }, "account-a")
  c.flush()
  c.recordUsage({ id: "msg-2", finish: "stop", tokens: tok(200, 80) }, "account-a")
  c.flush()

  const store = aggregateStats(statsDir, 1)
  expect(store[todayLocal()]["account-a"].req).toBe(2)
  expect(store[todayLocal()]["account-a"].in).toBe(300)
})

test("重复 flush 不重复追加(无新增量时不写行)", () => {
  const c = makeCollector()
  c.recordUsage({ id: "msg-1", finish: "stop", tokens: tok(10, 5) }, "account-a")
  c.flush()
  c.flush()

  const file = join(statsDir, `${todayLocal()}.jsonl`)
  const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
  expect(lines).toHaveLength(1)

  const store = aggregateStats(statsDir, 1)
  expect(store[todayLocal()]["account-a"].req).toBe(1)
})

test("损坏行跳过,不影响聚合", () => {
  mkdirSync(statsDir, { recursive: true })
  const file = join(statsDir, `${todayLocal()}.jsonl`)
  writeFileSync(
    file,
    `{"day":"${todayLocal()}","provider":"account-a","req":1,"in":10,"out":5,"reasoning":0,"cacheRead":0,"cacheWrite":0,"cost":0}\nnot-json\n`,
  )

  const store = aggregateStats(statsDir, 1)
  expect(store[todayLocal()]["account-a"].req).toBe(1)
  expect(store[todayLocal()]["account-a"].in).toBe(10)
})

test("缺 id 忽略", () => {
  const c = makeCollector()
  const ret = c.recordUsage(
    { role: "assistant", finish: "stop", tokens: tok(100, 50) } as unknown as UsageInput,
    "account-a",
  )
  expect(ret).toBe(false)
  expect(c.getStore()[todayLocal()]).toBeUndefined()
})

test("不同 id 各计一次", () => {
  const c = makeCollector()
  c.recordUsage({ id: "msg-1", finish: "stop", tokens: tok(100, 50) }, "account-a")
  c.recordUsage({ id: "msg-2", finish: "stop", tokens: tok(200, 80) }, "account-a")
  const day = c.getStore()[todayLocal()]
  expect(day["account-a"].req).toBe(2)
  expect(day["account-a"].in).toBe(300)
})

test("stop 只 flush 不 drain(无 buffer)", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", finish: "stop", tokens: tok(100, 500) },
    "account-a",
  )
  c.stop()
  const day = c.getStore()[todayLocal()]
  expect(day["account-a"].req).toBe(1)
  expect(day["account-a"].in).toBe(100)
})

test("全零 token 事件跳过(assistant 消息创建)", () => {
  const c = makeCollector()
  const ret = c.recordUsage(
    { id: "msg-1", finish: "stop", tokens: tok(0, 0) },
    "account-a",
  )
  expect(ret).toBe(false)
  expect(c.getStore()[todayLocal()]).toBeUndefined()
})

test("全零后跟真实 token 正常累加", () => {
  const c = makeCollector()
  c.recordUsage(
    { id: "msg-1", finish: undefined, tokens: tok(0, 0) },
    "account-a",
  )
  const ret = c.recordUsage(
    { id: "msg-1", finish: "stop", tokens: tok(100, 50) },
    "account-a",
  )
  expect(ret).toBe(true)
  const day = c.getStore()[todayLocal()]
  expect(day["account-a"].req).toBe(1)
  expect(day["account-a"].in).toBe(100)
})
