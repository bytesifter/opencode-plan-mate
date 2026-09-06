import { tool, type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseOptions, collectProviders } from "./config"
import { ProviderPool } from "./pool"
import { patchFetch } from "./fetch-patch"
import { StatsCollector, aggregateStats, type UsageInput } from "./stats"
import { renderChart } from "./chart"
import { collectPlanQuotas, defaultSpawn, renderPlanChart } from "./quota"
import { Logger, tail, type UsageTokens } from "./logger"
import type { EventContext } from "./types"

/** 图表默认展示天数 */
const DEFAULT_CHART_DAYS = 7

let globalStats: StatsCollector | null = null
let globalStatsDir: string | null = null
let globalLogger: Logger | null = null
let globalPool: ProviderPool | null = null
let fetchPatched = false
const corrMap = new Map<string, string>()

/**
 * 插件 server 入口。
 *
 * 使用模块级单例:opencode 为每个项目目录调用 server(),但 StatsCollector、Logger、
 * ProviderPool、patchFetch 全局共享。
 */
const server: Plugin = async (_input, options) => {
  const opts = parseOptions(options as Record<string, unknown> | undefined)

  if (!globalStats) {
    const statsDir = opts.statsDir ?? defaultPath("round-robin-stats")
    globalStatsDir = statsDir
    globalStats = new StatsCollector(statsDir)
    if (opts.logPath) {
      globalLogger = new Logger(opts.logPath)
    } else {
      const logDir = opts.logDir ?? defaultDir()
      globalLogger = new Logger(logDir, { rotation: true })
    }
  }

  return {
    config: async (config) => {
      if (fetchPatched) return
      const entries = collectProviders(
        config as unknown as { provider?: Record<string, { options?: { apiKey?: string; baseURL?: string } }> },
        opts.providers,
      )
      globalPool = new ProviderPool(entries, opts.cooldownMs, opts.quotaCooldownMs)
      patchFetch(globalPool, {
        onCorrelate: (sessionID, account) => {
          corrMap.set(sessionID, account)
        },
        onResponse: (pool, entry, status, durationMs, cooldownType) => {
          const idx = pool.keyIndex(entry.key)
          const account = entry.account
          globalLogger!.logFetch(account, idx, tail(entry.key), status, durationMs)
          if (cooldownType) {
            const ms = cooldownType === "quota-exhausted" ? pool.quotaCooldownMs : pool.cooldownMs
            globalLogger!.logCooldown(account, idx, tail(entry.key), cooldownType, ms)
          }
        },
      })
      fetchPatched = true
    },
    event: async ({ event }) => {
      const e = event as {
        type?: string
        properties?: {
          info?: UsageInput & {
            sessionID?: string
            modelID?: string
            providerID?: string
            mode?: string
            agent?: string
            time?: { created?: number; completed?: number }
          }
        }
      }
      if (e.type === "message.updated" && e.properties?.info) {
        const info = e.properties.info
        const provider = (info.sessionID && corrMap.get(info.sessionID)) || info.providerID || "unknown"
        const committed = globalStats!.recordUsage(info, provider)
        if (committed) {
          const ctx: EventContext = {
            sessionID: info.sessionID ? info.sessionID.slice(0, 8) : undefined,
            modelID: info.modelID,
            providerID: provider,
            mode: info.mode,
            agent: info.agent,
            durationMs:
              typeof info.time?.created === "number" && typeof info.time?.completed === "number"
                ? info.time.completed - info.time.created
                : 0,
          }
          globalLogger!.logUsage(info.tokens as UsageTokens, typeof info.cost === "number" ? info.cost : 0, ctx)
        }
        if (info.finish && (info.finish === "stop" || info.finish === "error" || info.finish === "unknown")) {
          if (info.sessionID) corrMap.delete(info.sessionID)
        }
      }
    },
    tool: {
      roundrobin_stats: tool({
        description: "查看 opencode-round-robin 按天统计(请求数与 token 消耗)",
        args: { days: tool.schema.number().optional() },
        execute: async (args) => {
          const days = typeof args.days === "number" ? args.days : DEFAULT_CHART_DAYS
          globalStats!.flush()
          const store = aggregateStats(globalStatsDir!, days)
          return renderChart(store, days)
        },
      }),
      plan_stats: tool({
        description:
          "查看各 Coding Plan(账号)的官方配额用量(percent + 重置时间)。需在插件 options 配置 planStats.accounts(显示名 → 隔离 arkcli HOME),且每个账号已在该 HOME 下 SSO 登录",
        args: {},
        execute: async () => {
          const accounts = opts.planStats?.accounts
          if (!accounts || Object.keys(accounts).length === 0) {
            return '未配置 planStats.accounts。请在插件 options 添加,例如 {"planStats":{"accounts":{"账号A":"~/.arkcli-accounts/a"}}}'
          }
          const quotas = await collectPlanQuotas(accounts, defaultSpawn)
          return renderPlanChart(quotas)
        },
      }),
    },
  }
}

const pluginModule: PluginModule = {
  id: "opencode-round-robin",
  server,
}

export default pluginModule

/**
 * 解析默认数据文件路径:优先 XDG_DATA_HOME,否则 ~/.local/share/opencode。
 */
function defaultPath(filename: string): string {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg ? join(xdg, "opencode") : join(homedir(), ".local", "share", "opencode")
  return join(base, filename)
}

/**
 * 解析默认日志目录:优先 XDG_DATA_HOME,否则 ~/.local/share/opencode。
 */
function defaultDir(): string {
  const xdg = process.env.XDG_DATA_HOME
  return xdg ? join(xdg, "opencode") : join(homedir(), ".local", "share", "opencode")
}
