import { spawn } from "node:child_process"
import type { PlanPeriod, PlanQuota, QuotaAdapter, SpawnExecutor, SpawnResult } from "./types"
import { bar, pad } from "./chart"

/** arkcli 子进程超时(毫秒) */
const DEFAULT_TIMEOUT_MS = 30000

/** 调用归因环境变量(见 arkcli-shared 调用归因协议) */
const CALLER_ENV: Record<string, string> = {
  ARKCLI_CALLER_TYPE: "ai_agent",
  ARKCLI_CALLER_NAME: "opencode",
  ARKCLI_SKILL_NAME: "arkcli-usage",
}

/** 渲染列宽(字符数) */
const COL_W = 16

/**
 * arkcli 子进程默认执行器:spawn 真实命令,捕获 stdout/stderr,超时 kill。
 * exitCode 为 null 表示命令无法启动(如 ENOENT:arkcli 未安装)。
 */
export const defaultSpawn: SpawnExecutor = (cmd, args, opts) => {
  return new Promise<SpawnResult>((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const child = spawn(cmd, args, { env: { ...process.env, ...(opts?.env ?? {}) } })
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
    const timer = opts?.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined
    child.on("error", (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ stdout, stderr: stderr || err.message, exitCode: null })
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code })
    })
  })
}

/**
 * 火山 arkcli adapter:以每账号隔离的 arkcli HOME 执行 `arkcli usage plan --product coding-plan`
 * 取官方配额。依赖本机 arkcli 且该 HOME 已 SSO 登录(控制面仅接受 SSO/AK-SK)。
 */
export const volcArkcliAdapter: QuotaAdapter = {
  id: "volc-arkcli",
  supports: () => true,
  fetch: async (account, home, exec) => {
    const res = await exec(
      "arkcli",
      ["usage", "plan", "--product", "coding-plan", "--format", "json"],
      { env: { ...CALLER_ENV, HOME: home }, timeoutMs: DEFAULT_TIMEOUT_MS },
    )
    if (res.exitCode === null) {
      return errQuota(account, `arkcli 不可用: ${res.stderr.trim() || "无法启动 arkcli"}`)
    }
    if (res.exitCode !== 0) {
      return errQuota(account, classifyError(`${res.stdout}\n${res.stderr}`))
    }
    return parseUsagePlan(account, res.stdout)
  },
}

/** adapter 注册表:新增 provider = 新增 adapter 并注册进数组 */
export const adapters: QuotaAdapter[] = [volcArkcliAdapter]

/**
 * 通用编排:并发查询每个账号的官方配额,单账号失败隔离。
 *
 * @param accounts - 账号映射(显示名 → 该账号隔离的 arkcli HOME 目录)
 * @param exec - 子进程执行器(测试注入 fake)
 * @param registry - adapter 注册表(默认全局;测试可传空数组触发"不支持的 provider")
 */
export async function collectPlanQuotas(
  accounts: Record<string, string>,
  exec: SpawnExecutor,
  registry: QuotaAdapter[] = adapters,
): Promise<PlanQuota[]> {
  const results = await Promise.all(
    Object.entries(accounts).map(async ([account, home]) => {
      const adapter = registry.find((a) => a.supports(account))
      if (!adapter) {
        return { provider: account, kind: "unknown", subscribed: false, periods: [], error: "不支持的 provider" }
      }
      try {
        return await adapter.fetch(account, home, exec)
      } catch (e) {
        return { provider: account, kind: "unknown", subscribed: false, periods: [], error: errMsg(e) }
      }
    }),
  )
  return results
}

/**
 * 渲染 plan_stats 结果:每行一个 profile,session/weekly/monthly 三窗口 percent 柱 + 重置时间。
 * 无任何可用数据(全失败/全未订阅)时返回"暂无统计数据"。
 */
export function renderPlanChart(quotas: PlanQuota[]): string {
  if (quotas.filter((q) => q.periods.length > 0).length === 0) {
    return "暂无统计数据"
  }
  const col = (s: string) => s.padEnd(COL_W)
  const lines: string[] = []
  lines.push("coding-plan 官方配额 (plan_stats)")
  lines.push(`${col("profile")}  ${col("session")}  ${col("weekly")}  ${col("monthly")}`)
  for (const q of quotas) {
    if (q.error) {
      lines.push(`${col(pad(q.provider, COL_W))}  ⚠ ${q.error}`)
      continue
    }
    const by = periodByLabel(q.periods)
    lines.push(
      `${col(pad(q.provider, COL_W))}  ${col(cell(by.session))}  ${col(cell(by.weekly))}  ${col(cell(by.monthly))}`,
    )
    const resets = [resetCell(by.session), resetCell(by.weekly), resetCell(by.monthly)]
    if (resets.some((r) => r)) {
      lines.push(`${col("")}  ${col(resets[0])}  ${col(resets[1])}  ${col(resets[2])}`)
    }
    if (!q.subscribed) {
      lines.push(`${col("")}  (未订阅/无套餐)`)
    }
  }
  return lines.join("\n")
}

/** `arkcli usage plan` 输出里 items[] 的一项(仅取需要的字段,容错) */
interface UsagePlanItem {
  product?: string
  edition?: string
  subscribed?: boolean
  periods?: { label?: string; percent?: number; reset_at?: string }[]
  updated_at?: string | number
  error?: string
}

function parseUsagePlan(profile: string, stdout: string): PlanQuota {
  let parsed: { items?: UsagePlanItem[] }
  try {
    parsed = JSON.parse(stdout) as { items?: UsagePlanItem[] }
  } catch {
    return errQuota(profile, "arkcli 输出解析失败(期望 JSON)")
  }
  const item = (parsed.items ?? []).find((i) => i.product === "coding-plan")
  if (!item) {
    return errQuota(profile, "usage plan 未返回 coding-plan 桶")
  }
  if (item.error) {
    return errQuota(profile, item.error)
  }
  const periods: PlanPeriod[] = (item.periods ?? [])
    .filter((p) => typeof p?.label === "string" && p.label.length > 0)
    .map((p) => ({
      label: p.label as string,
      percent: num(p.percent),
      resetAt: typeof p.reset_at === "string" && p.reset_at.length > 0 ? p.reset_at : undefined,
    }))
  return {
    provider: profile,
    kind: "coding-plan",
    subscribed: item.subscribed === true,
    periods,
    updatedAt: item.updated_at != null ? String(item.updated_at) : undefined,
  }
}

/** 非零退出码的错误分类:未登录 / profile 不存在 / 其他(取首行摘要) */
function classifyError(text: string): string {
  const t = text.toLowerCase()
  if (t.includes("sso") || t.includes("not logged") || t.includes("login")) {
    return "未登录(需 arkcli auth login volc-sso)"
  }
  if (t.includes("profile") && t.includes("not found")) {
    return "arkcli profile 不存在"
  }
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0)
  return firstLine ? firstLine.slice(0, 120) : "arkcli 查询失败"
}

function errQuota(profile: string, error: string): PlanQuota {
  return { provider: profile, kind: "coding-plan", subscribed: false, periods: [], error }
}

function periodByLabel(periods: PlanPeriod[]): Record<string, PlanPeriod | undefined> {
  const m: Record<string, PlanPeriod | undefined> = {}
  for (const p of periods) m[p.label] = p
  return m
}

function cell(p?: PlanPeriod): string {
  if (!p) return "—"
  return `${bar(p.percent, 100, 8)} ${String(p.percent).padStart(3)}%`
}

function resetCell(p?: PlanPeriod): string {
  return p?.resetAt ? `重置 ${shortDate(p.resetAt)}` : ""
}

/** RFC3339 -> MM-DD HH:MM(本地时区);解析失败回退前 10 位 */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${mm}-${dd} ${hh}:${mi}`
}

function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
