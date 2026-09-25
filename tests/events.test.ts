import { test, expect } from "bun:test"
import { resolveStepUsage, attributeStep, isReplayedEvent, isLocationMatch, TERMINAL_FINISH } from "../src/event-adapter"

function stepEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_step1",
    created: 12345,
    type: "session.step.ended",
    location: { directory: "D:\\code\\demo" },
    data: {
      sessionID: "sess_abc",
      assistantMessageID: "msg_1",
      finish: "stop",
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 3 } },
      cost: 0.02,
    },
    ...overrides,
  }
}

test("session.step.ended 解析为归一化单步用量", () => {
  const u = resolveStepUsage(stepEvent())
  expect(u).not.toBeNull()
  expect(u!.eventID).toBe("evt_step1")
  expect(u!.created).toBe(12345)
  expect(u!.durableKey).toBe("evt_step1") // 无 durable 时 fallback 到 event.id
  expect(u!.locationDirectory).toBe("D:\\code\\demo")
  expect(u!.failed).toBe(false)
  expect(u!.sessionID).toBe("sess_abc")
  expect(u!.assistantMessageID).toBe("msg_1")
  expect(u!.finish).toBe("stop")
  expect(u!.tokens).toEqual({ input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 3 } })
  expect(u!.cost).toBe(0.02)
})

test("durable 存在时 durableKey 为 aggregateID:seq", () => {
  const u = resolveStepUsage(
    stepEvent({
      durable: { aggregateID: "sess_abc", seq: 42, version: 1 },
    }),
  )
  expect(u!.durableKey).toBe("sess_abc:42")
})

test("durable 缺失时 durableKey fallback 到 event.id", () => {
  const u = resolveStepUsage(stepEvent({ durable: undefined, id: "evt_fallback" }))
  expect(u!.durableKey).toBe("evt_fallback")
})

test("durable 与 event.id 皆缺时 durableKey 为空串", () => {
  const u = resolveStepUsage(stepEvent({ durable: undefined, id: undefined }))
  expect(u!.durableKey).toBe("")
})

test("created 缺失时解析为 0", () => {
  const u = resolveStepUsage(stepEvent({ created: undefined }))
  expect(u!.created).toBe(0)
})

test("location 缺失时 locationDirectory 为 undefined", () => {
  const u = resolveStepUsage(stepEvent({ location: undefined }))
  expect(u!.locationDirectory).toBeUndefined()
})

test("isLocationMatch:位置匹配返回 true", () => {
  expect(isLocationMatch("D:\\code\\demo", "D:\\code\\demo")).toBe(true)
})

test("isLocationMatch:位置不匹配返回 false", () => {
  expect(isLocationMatch("D:\\code\\other", "D:\\code\\demo")).toBe(false)
})

test("isLocationMatch:事件缺 location 返回 false", () => {
  expect(isLocationMatch(undefined, "D:\\code\\demo")).toBe(false)
  expect(isLocationMatch("", "D:\\code\\demo")).toBe(false)
})

test("session.step.ended 中间态 tool-calls 解析,不视为失败", () => {
  const u = resolveStepUsage(stepEvent({ data: { ...stepEvent().data, finish: "tool-calls" } }))
  expect(u).not.toBeNull()
  expect(u!.finish).toBe("tool-calls")
  expect(u!.failed).toBe(false)
})

test("session.step.failed 解析且标记 failed", () => {
  const u = resolveStepUsage(
    stepEvent({
      id: "evt_fail1",
      type: "session.step.failed",
      data: {
        sessionID: "sess_abc",
        assistantMessageID: "msg_1",
        error: { type: "provider-error", message: "boom" },
        tokens: { input: 30, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    }),
  )
  expect(u).not.toBeNull()
  expect(u!.failed).toBe(true)
  expect(u!.tokens.input).toBe(30)
  expect(u!.cost).toBeUndefined()
})

test("非用量事件返回 null", () => {
  expect(resolveStepUsage({ id: "e1", type: "session.text.delta", data: {} })).toBeNull()
  expect(resolveStepUsage(null)).toBeNull()
  expect(resolveStepUsage(undefined)).toBeNull()
  expect(resolveStepUsage("nope")).toBeNull()
})

test("缺 data.sessionID 返回 null", () => {
  const e = stepEvent({ data: { ...stepEvent().data, sessionID: undefined } })
  expect(resolveStepUsage(e)).toBeNull()
})

test("缺 data.tokens 返回 null", () => {
  const e = stepEvent({ data: { ...stepEvent().data, tokens: undefined } })
  expect(resolveStepUsage(e)).toBeNull()
})

test("全零 token 返回 null(非真实用量报告)", () => {
  const e = stepEvent({
    data: {
      ...stepEvent().data,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  })
  expect(resolveStepUsage(e)).toBeNull()
})

const usage = (finish: string | undefined, failed = false) => ({
  eventID: "evt_1",
  created: 999999,
  durableKey: "sess_abc:1",
  failed,
  sessionID: "sess_abc",
  assistantMessageID: "msg_1",
  finish,
  tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
})

const noopResolver = async () => undefined

test("isReplayedEvent:created 早于 startTime 判定为回放", () => {
  expect(isReplayedEvent(1000, 2000)).toBe(true)
})

test("isReplayedEvent:created 不早于 startTime 判定为实时", () => {
  expect(isReplayedEvent(2000, 2000)).toBe(false) // 等于 startTime 保留
  expect(isReplayedEvent(3000, 2000)).toBe(false)
})

test("isReplayedEvent:created 缺失(0)判定为实时", () => {
  expect(isReplayedEvent(0, 2000)).toBe(false)
})

test("corrMap 命中:归因到映射 provider,不触发 fallback", async () => {
  const corr = new Map([["sess_abc", "volxc9208"]])
  let called = false
  const { provider, cleanup } = await attributeStep(usage("stop"), corr, async () => {
    called = true
    return "volhwy2410"
  })
  expect(provider).toBe("volxc9208")
  expect(called).toBe(false)
  expect(cleanup).toBe(true)
})

test("corrMap miss 且会话 provider 可确定:fallback 到会话当前 provider", async () => {
  const corr = new Map<string, string>()
  const { provider, cleanup } = await attributeStep(usage("stop"), corr, async () => "volhwy2410")
  expect(provider).toBe("volhwy2410")
  expect(cleanup).toBe(true)
})

test("corrMap miss 且查询失败:归入 unknown", async () => {
  const corr = new Map<string, string>()
  const { provider } = await attributeStep(usage("stop"), corr, async () => undefined)
  expect(provider).toBe("unknown")
})

test("终态 finish(stop/error/unknown)触发清理", async () => {
  for (const finish of [...TERMINAL_FINISH]) {
    const { cleanup } = await attributeStep(usage(finish), new Map(), noopResolver)
    expect(cleanup).toBe(true)
  }
})

test("中间态 finish(tool-calls)不触发清理", async () => {
  const { cleanup } = await attributeStep(usage("tool-calls"), new Map(), noopResolver)
  expect(cleanup).toBe(false)
})

test("session.step.failed 无论 finish 均触发清理", async () => {
  const { cleanup } = await attributeStep(usage(undefined, true), new Map(), noopResolver)
  expect(cleanup).toBe(true)
})
