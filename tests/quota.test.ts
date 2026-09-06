import { test, expect } from "bun:test"
import { collectPlanQuotas, renderPlanChart, volcArkcliAdapter } from "../src/quota"
import type { SpawnExecutor } from "../src/types"

const okItem = (subscribed = true, periods?: unknown) =>
  JSON.stringify({
    viewer: { auth_method: "sso" },
    items: [
      {
        product: "coding-plan",
        edition: "personal",
        subscribed,
        periods:
          periods ??
          [
            { label: "session", percent: 40, reset_at: "2026-09-05T20:00:00+08:00" },
            { label: "weekly", percent: 55, reset_at: "2026-09-10T00:00:00+08:00" },
            { label: "monthly", percent: 30, reset_at: "2026-09-30T00:00:00+08:00" },
          ],
        updated_at: 1725000000000,
      },
    ],
  })

/** 构造 fake spawn:按 env.HOME 返回预设结果,并记录调用(命令 + env) */
function fakeExec(
  results: Record<string, { stdout?: string; stderr?: string; exitCode: number | null }>,
): { exec: SpawnExecutor; calls: { args: string[]; env?: Record<string, string> }[] } {
  const calls: { args: string[]; env?: Record<string, string> }[] = []
  const exec: SpawnExecutor = async (_cmd, args, opts) => {
    calls.push({ args, env: opts.env })
    const home = opts.env?.HOME ?? ""
    const r = results[home] ?? { exitCode: 0, stdout: "{}" }
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.exitCode }
  }
  return { exec, calls }
}

// ===== adapter:正常解析 + 隔离 HOME 取数 =====
test("正常解析 coding-plan 配额,带隔离 HOME", async () => {
  const { exec, calls } = fakeExec({ "/home/volc-a": { exitCode: 0, stdout: okItem() } })
  const quota = await volcArkcliAdapter.fetch("volc-a", "/home/volc-a", exec)
  expect(quota.provider).toBe("volc-a")
  expect(quota.kind).toBe("coding-plan")
  expect(quota.subscribed).toBe(true)
  expect(quota.error).toBeUndefined()
  expect(quota.periods).toHaveLength(3)
  expect(quota.periods.map((p) => p.label)).toEqual(["session", "weekly", "monthly"])
  expect(quota.periods[0].percent).toBe(40)
  expect(quota.periods[0].resetAt).toBe("2026-09-05T20:00:00+08:00")
  // 命令:无 --profile
  expect(calls[0].args).toEqual(["usage", "plan", "--product", "coding-plan", "--format", "json"])
  // env:注入隔离 HOME + 归因 env
  expect(calls[0].env?.HOME).toBe("/home/volc-a")
  expect(calls[0].env?.ARKCLI_CALLER_NAME).toBe("opencode")
  expect(calls[0].env?.ARKCLI_SKILL_NAME).toBe("arkcli-usage")
})

// ===== adapter:未订阅 =====
test("未订阅返回 subscribed=false", async () => {
  const { exec } = fakeExec({ "/home/volc-a": { exitCode: 0, stdout: okItem(false, []) } })
  const quota = await volcArkcliAdapter.fetch("volc-a", "/home/volc-a", exec)
  expect(quota.subscribed).toBe(false)
  expect(quota.periods).toHaveLength(0)
  expect(quota.error).toBeUndefined()
})

// ===== adapter:未登录 =====
test("未登录(需 SSO)分类", async () => {
  const { exec } = fakeExec({
    "/home/volc-a": { exitCode: 1, stderr: "GetCodingPlanUsage requires Volcengine Ark SSO STS, please run arkcli auth login volc-sso" },
  })
  const quota = await volcArkcliAdapter.fetch("volc-a", "/home/volc-a", exec)
  expect(quota.error).toContain("未登录")
})

// ===== adapter:错误文本分类 =====
test("profile 不存在分类", async () => {
  const { exec } = fakeExec({ "/home/nope": { exitCode: 1, stderr: 'profile "nope" not found; run `arkcli profile list`' } })
  const quota = await volcArkcliAdapter.fetch("nope", "/home/nope", exec)
  expect(quota.error).toContain("profile 不存在")
})

// ===== adapter:命令缺失 =====
test("arkcli 不可用(ENOENT)分类", async () => {
  const { exec } = fakeExec({ "/home/volc-a": { exitCode: null, stderr: "spawn arkcli ENOENT" } })
  const quota = await volcArkcliAdapter.fetch("volc-a", "/home/volc-a", exec)
  expect(quota.error).toContain("arkcli 不可用")
})

// ===== adapter:畸形输出 =====
test("畸形输出报解析失败", async () => {
  const { exec } = fakeExec({ "/home/volc-a": { exitCode: 0, stdout: "not-json-at-all" } })
  const quota = await volcArkcliAdapter.fetch("volc-a", "/home/volc-a", exec)
  expect(quota.error).toContain("解析失败")
})

// ===== adapter:item.error 透传 =====
test("item.error 透传到行", async () => {
  const body = JSON.stringify({
    items: [{ product: "coding-plan", subscribed: true, error: "some upstream error" }],
  })
  const { exec } = fakeExec({ "/home/volc-a": { exitCode: 0, stdout: body } })
  const quota = await volcArkcliAdapter.fetch("volc-a", "/home/volc-a", exec)
  expect(quota.error).toBe("some upstream error")
})

// ===== 编排:多账号并发 + 失败隔离 + 各自 HOME =====
test("多账号并发,单失败不阻塞,各自带 HOME", async () => {
  const { exec, calls } = fakeExec({
    "/home/volc-a": { exitCode: 0, stdout: okItem() },
    "/home/volc-b": { exitCode: 1, stderr: "SSO required" },
    "/home/volc-c": { exitCode: 0, stdout: okItem(false, []) },
  })
  const quotas = await collectPlanQuotas(
    { "volc-a": "/home/volc-a", "volc-b": "/home/volc-b", "volc-c": "/home/volc-c" },
    exec,
  )
  expect(quotas).toHaveLength(3)
  const a = quotas.find((q) => q.provider === "volc-a")!
  expect(a.periods).toHaveLength(3)
  const b = quotas.find((q) => q.provider === "volc-b")!
  expect(b.error).toContain("未登录")
  const c = quotas.find((q) => q.provider === "volc-c")!
  expect(c.subscribed).toBe(false)
  // 三个调用分别注入各自 HOME
  const homes = calls.map((c) => c.env?.HOME).sort()
  expect(homes).toEqual(["/home/volc-a", "/home/volc-b", "/home/volc-c"])
})

// ===== 编排:exec 抛异常也隔离 =====
test("exec 抛异常被隔离为错误行", async () => {
  const throwing: SpawnExecutor = async () => {
    throw new Error("boom")
  }
  const quotas = await collectPlanQuotas({ "volc-a": "/home/a", "volc-b": "/home/b" }, throwing)
  expect(quotas).toHaveLength(2)
  for (const q of quotas) expect(q.error).toBe("boom")
})

// ===== 编排:无匹配 adapter =====
test("无匹配 adapter 标注不支持的 provider", async () => {
  const { exec } = fakeExec({})
  const quotas = await collectPlanQuotas({ "volc-a": "/home/a" }, exec, [])
  expect(quotas[0].error).toBe("不支持的 provider")
})

// ===== 渲染:有数据 =====
test("渲染含 profile/percent/重置", () => {
  const out = renderPlanChart([
    { provider: "volc-a", kind: "coding-plan", subscribed: true, periods: [
      { label: "session", percent: 40, resetAt: "2026-09-05T20:00:00+08:00" },
      { label: "weekly", percent: 55 },
      { label: "monthly", percent: 30 },
    ] },
    { provider: "volc-b", kind: "coding-plan", subscribed: false, periods: [] },
    { provider: "volc-c", kind: "coding-plan", subscribed: false, periods: [], error: "未登录(需 arkcli auth login volc-sso)" },
  ])
  expect(out).toContain("volc-a")
  expect(out).toContain("40%")
  expect(out).toContain("55%")
  expect(out).toContain("█")
  expect(out).toContain("重置")
  expect(out).toContain("未订阅/无套餐")
  expect(out).toContain("未登录")
})

// ===== 渲染:无数据 =====
test("全失败/全未订阅返回暂无统计数据", () => {
  const out = renderPlanChart([
    { provider: "volc-a", kind: "coding-plan", subscribed: false, periods: [], error: "未登录" },
    { provider: "volc-b", kind: "coding-plan", subscribed: false, periods: [] },
  ])
  expect(out).toBe("暂无统计数据")
})

test("空数组返回暂无统计数据", () => {
  expect(renderPlanChart([])).toBe("暂无统计数据")
})
