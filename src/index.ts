import { Plugin } from "@opencode/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseOptions, collectProviders, loadProviderConfig, configFileCandidates } from "./config"
import { ProviderPool } from "./pool"
import { handleHttpRequest, handleHttpResponse, type HttpHookCallbacks } from "./http-hooks"
import { StatsCollector, aggregateStats } from "./stats"
import { resolveStepUsage, attributeStep, isReplayedEvent, isLocationMatch } from "./event-adapter"
import { renderChart } from "./chart"
import { collectPlanQuotas, defaultSpawn, renderPlanChart } from "./quota"
import { Logger, tail } from "./logger"
import type { EventContext } from "./types"

/** 图表默认展示天数 */
const DEFAULT_CHART_DAYS = 7

/** 模块级单例:opencode 在每个加载位置调用 setup(),共享运行态(见 specs/plugin-loading) */
let globalStats: StatsCollector | null = null
let globalStatsDir: string | null = null
let globalLogger: Logger | null = null
let globalPool: ProviderPool | null = null
let hooksRegistered = false

/** 插件启动时刻:回放过滤依据(忽略 created 早于该时刻的历史 durable 事件) */
let pluginStartTime = 0

/** 插件加载位置目录:按位置过滤依据(多位置实例各处理自己的会话) */
let pluginDirectory = ""

/** sessionID → provider 关联(http.request 钩子建立,事件层 token 归因使用) */
const corrMap = new Map<string, string>()

/**
 * v2 插件入口。
 *
 * - http.request / http.response 钩子:key 轮询与 429/402 熔断(替代 V1 fetch monkey-patch)
 * - ctx.event.subscribe:用量统计与 token 日志(替代 V1 event hook)
 * - ctx.tool.transform:注册 plan_mate_stats / plan_stats(替代 V1 tool hook + zod)
 * - 拦截器与共享实例只在首个 setup 初始化,后续位置复用
 */
export default Plugin.define({
  id: "opencode-plan-mate",
  async setup(ctx) {
    pluginStartTime = Date.now()
    pluginDirectory = ctx.location.directory
    const opts = parseOptions(ctx.options as Record<string, unknown> | undefined)

    if (!globalStats) {
      const statsDir = opts.statsDir ?? defaultPath("plan-mate-stats")
      globalStatsDir = statsDir
      globalStats = new StatsCollector(statsDir)
      if (opts.logPath) {
        globalLogger = new Logger(opts.logPath)
      } else {
        const logDir = opts.logDir ?? defaultDir()
        globalLogger = new Logger(logDir, { rotation: true })
      }
    }

    // provider 收集:v2 的 ctx.provider 不含 apiKey(凭证属连接层),从配置文件读取(见 design D2)
    const config = loadProviderConfig(
      configFileCandidates(globalConfigDir(), ctx.location.directory),
    )
    if (!globalPool) {
      const entries = collectProviders(config, opts.providers)
      globalPool = new ProviderPool(entries, opts.cooldownMs, opts.quotaCooldownMs)
    }

    // 拦截器只注册一次(模块级单例,多位置共享 pool/熔断/统计)
    if (!hooksRegistered && globalPool.entryCount > 0) {
      const callbacks: HttpHookCallbacks = {
        onCorrelate: (sessionID, account) => {
          corrMap.set(sessionID, account)
        },
        onResponse: (pool, entry, status, durationMs, cooldownType) => {
          const idx = pool.keyIndex(entry.key)
          globalLogger!.logFetch(entry.account, idx, tail(entry.key), status, durationMs)
          if (cooldownType) {
            const ms = cooldownType === "quota-exhausted" ? pool.quotaCooldownMs : pool.cooldownMs
            globalLogger!.logCooldown(entry.account, idx, tail(entry.key), cooldownType, ms)
          }
        },
      }
      await ctx.session.hook("http.request", (event) => handleHttpRequest(event, globalPool!, callbacks))
      await ctx.session.hook("http.response", (event) => handleHttpResponse(event, globalPool!, callbacks))
      hooksRegistered = true
    }

    // 工具注册(JSON Schema 入参,替代 V1 tool() + zod)
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "plan_mate_stats",
        description: "查看 opencode-plan-mate 按天统计(请求数与 token 消耗)",
        input: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
        execute: async (args) => {
          const days = typeof (args as { days?: number } | undefined)?.days === "number"
            ? (args as { days?: number }).days!
            : DEFAULT_CHART_DAYS
          globalStats!.flush()
          const store = aggregateStats(globalStatsDir!, days)
          return { content: renderChart(store, days) }
        },
      })
      editor.add({
        name: "plan_stats",
        description:
          "查看各 Coding Plan(账号)的官方配额用量(percent + 重置时间)。需在插件 options 配置 planStats.accounts(显示名 → 隔离 arkcli HOME),且每个账号已在该 HOME 下 SSO 登录",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => {
          const accounts = opts.planStats?.accounts
          if (!accounts || Object.keys(accounts).length === 0) {
            return {
              content:
                '未配置 planStats.accounts。请在插件 options 添加,例如 {"planStats":{"accounts":{"账号A":"~/.arkcli-accounts/a"}}}',
            }
          }
          const quotas = await collectPlanQuotas(accounts, defaultSpawn)
          return { content: renderPlanChart(quotas) }
        },
      })
    })

    // 事件订阅:session.step.ended / session.step.failed 的 token 归因与日志(替代 V1 event hook)
    const controller = new AbortController()
    void (async () => {
      const resolveProvider = async (sessionID: string): Promise<string | undefined> => {
        try {
          const session = await ctx.session.get({ sessionID })
          return session?.model?.providerID
        } catch {
          return undefined
        }
      }
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        await handleEvent(event, globalStats!, globalLogger!, resolveProvider)
      }
    })()

    return () => {
      controller.abort()
      globalStats?.stop()
    }
  },
})

/**
 * 处理单个事件:session.step.ended / session.step.failed 时累计统计并记日志。
 * token 归因到实际服务的 provider(经 corrMap),无关联时 fallback 到会话当前 provider,再降级 unknown。
 * 终态 finish 或 step.failed 后清理 corrMap 关联。
 */
async function handleEvent(
  event: unknown,
  stats: StatsCollector,
  logger: Logger,
  resolveProvider: (sessionID: string) => Promise<string | undefined>,
): Promise<void> {
  const usage = resolveStepUsage(event)
  if (!usage) return
  // 按位置过滤:只处理本插件实例位置的会话事件(多位置实例互不干扰,消除跨实例重复)
  if (!isLocationMatch(usage.locationDirectory, pluginDirectory)) return
  // 回放过滤:忽略 created 早于插件启动时刻的历史 durable 事件回放(created 缺失视为实时)
  if (isReplayedEvent(usage.created, pluginStartTime)) return
  const { provider, cleanup } = await attributeStep(usage, corrMap, resolveProvider)
  const committed = stats.recordUsage(
    { id: usage.eventID, finish: usage.finish, tokens: usage.tokens, cost: usage.cost },
    provider,
    usage.durableKey,
  )
  if (committed) {
    const c: EventContext = {
      sessionID: usage.sessionID.slice(0, 8),
      providerID: provider,
    }
    logger.logUsage(usage.tokens, typeof usage.cost === "number" ? usage.cost : 0, c)
  }
  if (cleanup) {
    corrMap.delete(usage.sessionID)
  }
}

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

/**
 * 解析全局配置目录:优先 XDG_CONFIG_HOME,否则 ~/.config/opencode。
 */
function globalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? join(xdg, "opencode") : join(homedir(), ".config", "opencode")
}
