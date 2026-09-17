import { test, expect, beforeEach, afterEach } from "bun:test"
import { Logger, tail } from "../src/logger"
import { mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { EventContext } from "../src/types"

const tmpDir = join(import.meta.dir, ".tmp-logger")
const logPath = join(tmpDir, "rr.log")
const logDir = join(tmpDir, "logs")

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("fetch 层日志含账号名/key序号/末4位/状态码/duration", () => {
  const l = new Logger(logPath)
  l.logFetch("volxc9208", 0, tail("ark-test-key-xxxx-22898"), 200, 342)
  expect(existsSync(logPath)).toBe(true)
  const content = readFileSync(logPath, "utf8")
  expect(content).toContain("volxc9208")
  expect(content).toContain("key=#0")
  expect(content).toContain("200")
  expect(content).toContain("2898")
  expect(content).toContain("duration=342ms")
})

test("fetch 层日志不含 URL", () => {
  const l = new Logger(logPath)
  l.logFetch("volxc9208", 0, "..2898", 200, 100)
  const content = readFileSync(logPath, "utf8")
  expect(content).not.toContain("http")
  expect(content).not.toContain("https")
  expect(content).not.toContain("://")
})

test("key 脱敏:禁止明文,账号名明文", () => {
  const l = new Logger(logPath)
  const fullKey = "ark-test-key-xxxx-22898"
  const keyTail = tail(fullKey)
  l.logFetch("volxc9208", 0, keyTail, 200, 50)
  const content = readFileSync(logPath, "utf8")
  expect(content).not.toContain(fullKey)
  expect(content).toContain("2898")
  expect(content).toContain("volxc9208")
})

test("日志级别:200=INFO, 429=WARN, 402=WARN, 500=ERROR", () => {
  const l = new Logger(logPath)
  l.logFetch("p1", 0, "..1234", 200, 10)
  l.logFetch("p2", 1, "..5678", 429, 20)
  l.logFetch("p4", 3, "..4567", 402, 15)
  l.logFetch("p3", 2, "..9abc", 500, 30)
  const content = readFileSync(logPath, "utf8")
  const lines = content.trim().split("\n")
  expect(lines[0]).toContain("INFO")
  expect(lines[1]).toContain("WARN")
  expect(lines[2]).toContain("WARN")
  expect(lines[3]).toContain("ERROR")
})

test("429 冷却日志含账号名/WARN 级别", () => {
  const l = new Logger(logPath)
  l.logCooldown("volxc9208", 0, "..2898", "rate-limit", 60000)
  const content = readFileSync(logPath, "utf8")
  expect(content).toContain("cooldown")
  expect(content).toContain("60000")
  expect(content).toContain("volxc9208")
  expect(content).toContain("2898")
  expect(content).toContain("WARN")
})

test("冷却日志区分 rate-limit 与 quota-exhausted 类型", () => {
  const l = new Logger(logPath)
  l.logCooldown("account-a", 0, "..2898", "rate-limit", 60000)
  l.logCooldown("account-b", 1, "..2a5b", "quota-exhausted", 3600000)
  const content = readFileSync(logPath, "utf8")
  const lines = content.trim().split("\n")
  expect(lines[0]).toContain("rate-limit")
  expect(lines[0]).toContain("60000")
  expect(lines[1]).toContain("quota-exhausted")
  expect(lines[1]).toContain("3600000")
})

test("event 层日志含各分量/cost/业务上下文", () => {
  const l = new Logger(logPath)
  const ctx: EventContext = {
    sessionID: "a3f2",
    modelID: "glm-5.2",
    providerID: "volxc9208",
    mode: "code",
    agent: "opencode",
    durationMs: 1283,
  }
  l.logUsage(
    { input: 1000, output: 500, reasoning: 50, cache: { read: 30, write: 10 } },
    0.05,
    ctx,
  )
  const content = readFileSync(logPath, "utf8")
  expect(content).toContain("usage")
  expect(content).toContain("in=1000")
  expect(content).toContain("out=500")
  expect(content).toContain("reasoning=50")
  expect(content).toContain("cacheR=30")
  expect(content).toContain("cacheW=10")
  expect(content).toContain("cost=0.05")
  expect(content).toContain("session=a3f2")
  expect(content).toContain("model=glm-5.2")
  expect(content).toContain("provider=volxc9208")
  expect(content).toContain("mode=code")
  expect(content).toContain("agent=opencode")
  expect(content).toContain("duration=1283ms")
  expect(content).toContain("INFO")
})

test("event 层日志 session 截短为前4位", () => {
  const l = new Logger(logPath)
  const ctx: EventContext = {
    sessionID: "abcdef1234567890".slice(0, 4),
  }
  l.logUsage(
    { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    0,
    ctx,
  )
  const content = readFileSync(logPath, "utf8")
  expect(content).toContain("session=abcd")
  expect(content).not.toContain("abcdef1234567890")
})

test("时间戳精度到毫秒", () => {
  const l = new Logger(logPath)
  l.logFetch("p", 0, "..1234", 200, 10)
  const content = readFileSync(logPath, "utf8")
  expect(content).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)
})

test("多条日志 append 不覆盖", () => {
  const l = new Logger(logPath)
  l.logFetch("p1", 0, "..1234", 200, 10)
  l.logUsage({ input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, 0)
  l.logFetch("p2", 1, "..5678", 429, 20)
  const content = readFileSync(logPath, "utf8")
  const lines = content.trim().split("\n")
  expect(lines).toHaveLength(3)
  expect(lines[0]).toContain("p1")
  expect(lines[1]).toContain("usage")
  expect(lines[2]).toContain("p2")
})

test("rotation 模式:文件名含日期", () => {
  const l = new Logger(logDir, { rotation: true })
  l.logFetch("p", 0, "..1234", 200, 10)
  const files = readdirSync(logDir)
  expect(files.some((f) => f.startsWith("plan-mate-") && f.endsWith(".log"))).toBe(true)
  const dayFile = files.find((f) => f.startsWith("plan-mate-"))!
  const content = readFileSync(join(logDir, dayFile), "utf8")
  expect(content).toContain("p")
  expect(content).toContain("INFO")
})

test("rotation 模式:logDir 已存在不抛错且可写入", () => {
  mkdirSync(logDir, { recursive: true })
  let l!: Logger
  expect(() => {
    l = new Logger(logDir, { rotation: true })
  }).not.toThrow()
  l.logFetch("p", 0, "..1234", 200, 10)
  const files = readdirSync(logDir)
  expect(files.some((f) => f.startsWith("plan-mate-") && f.endsWith(".log"))).toBe(true)
})

test("simple 模式:文件名固定,不轮转", () => {
  const l = new Logger(logPath)
  l.logFetch("p", 0, "..1234", 200, 10)
  expect(existsSync(logPath)).toBe(true)
  const files = readdirSync(tmpDir)
  expect(files).toEqual(["rr.log"])
})
