import { test, expect } from "bun:test"
import { safeHandleEvent } from "../src/index"

// ===== 事件处理异常隔离(specs/usage-tracking 事件处理异常隔离)=====
test("单事件处理异常被捕获,不向调用方抛出", async () => {
  let calls = 0
  const throwing = async () => {
    calls++
    throw new Error("boom")
  }
  await expect(safeHandleEvent(throwing)).resolves.toBeUndefined()
  expect(calls).toBe(1)
})

test("正常事件处理不被包装改变", async () => {
  let calls = 0
  await safeHandleEvent(async () => {
    calls++
  })
  expect(calls).toBe(1)
})

test("异常事件被跳过,前后正常事件均被处理", async () => {
  const handled: number[] = []
  const events = [1, 2, 3]
  for (const e of events) {
    await safeHandleEvent(async () => {
      if (e === 2) throw new Error("boom")
      handled.push(e)
    })
  }
  // 异常中断不生效:事件 2 被跳过,事件 1/3 正常处理,循环继续
  expect(handled).toEqual([1, 3])
})

test("连续多个异常事件不终止处理链", async () => {
  const handled: number[] = []
  const events = [1, 2, 3, 4]
  for (const e of events) {
    await safeHandleEvent(async () => {
      if (e === 2 || e === 3) throw new Error("boom")
      handled.push(e)
    })
  }
  expect(handled).toEqual([1, 4])
})
