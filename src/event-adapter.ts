/**
 * v2 事件 → 归一化用量 解析适配层。
 *
 * 背景(见 specs/usage-tracking v2 契约):
 * - v2 事件流中不存在 v1 的 `message.updated`(`properties.info` 形态)
 * - 消息/用量事件改为 `session.step.ended`(每次 step 结束)与 `session.step.failed`(step 出错)
 * - 数据位于 `event.data`,含 `sessionID` / `assistantMessageID` / `finish` / `tokens` / `cost`
 * - v2 事件不带 `providerID`,归因由 index.ts 的关联映射 + 会话查询处理
 */
import { num } from "./util"

/** 解析后的单步用量(归一化形态,供统计与日志使用) */
export interface StepUsage {
  /** 事件 id(v2 事件流唯一),durable 缺失时的去重兜底 */
  eventID: string
  /** 事件创建时刻(毫秒时间戳),用于回放过滤(历史 durable 事件回放) */
  created: number
  /** durable 事件身份(`aggregateID:seq`),缺 durable 时 fallback 到 eventID,两者皆缺为空串(不去重) */
  durableKey: string
  /** 事件归属位置目录(event.location.directory),用于按位置过滤(多位置实例互不干扰) */
  locationDirectory?: string
  /** 事件类型:true 表示 session.step.failed(step 出错),否则为 session.step.ended */
  failed: boolean
  sessionID: string
  assistantMessageID: string
  /** step 终态:stop/length/tool-calls/content-filter/error/unknown */
  finish?: string
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  cost?: number
}

/** 支持的 v2 用量事件类型 */
const USAGE_EVENT_TYPES = new Set(["session.step.ended", "session.step.failed"])

/** 终态 finish 值:step 结束,可清理关联映射 */
export const TERMINAL_FINISH = new Set(["stop", "error", "unknown"])

/**
 * 单步用量的 provider 归因与关联清理判定。
 *
 * - 优先 `corrMap.get(sessionID)`(http.request 钩子建立的实际服务 provider)
 * - 未命中时经 `resolveProvider` 查会话当前 provider(v2 step 事件不再携带 providerID)
 * - 仍不可得归入 `unknown`
 *
 * @param usage - 已解析的单步用量
 * @param corrMap - sessionID -> provider 关联映射
 * @param resolveProvider - 关联映射 miss 时解析会话当前 provider 的回调
 * @returns provider 归因结果与是否需要清理关联
 */
export async function attributeStep(
  usage: StepUsage,
  corrMap: ReadonlyMap<string, string>,
  resolveProvider: (sessionID: string) => Promise<string | undefined>,
): Promise<{ provider: string; cleanup: boolean }> {
  const mapped = corrMap.get(usage.sessionID)
  const provider = mapped ?? (await resolveProvider(usage.sessionID)) ?? "unknown"
  const cleanup = usage.failed || (!!usage.finish && TERMINAL_FINISH.has(usage.finish))
  return { provider, cleanup }
}

/**
 * 从 v2 事件解析单步用量。
 *
 * - 仅处理 `session.step.ended` / `session.step.failed`,其他事件返回 null
 * - `data.sessionID` / `data.tokens` 缺失返回 null
 * - tokens 全零(非真实用量报告)返回 null
 *
 * @param event - v2 事件流中的原始事件对象
 * @returns 归一化单步用量,无法解析时返回 null
 */
export function resolveStepUsage(event: unknown): StepUsage | null {
  if (typeof event !== "object" || event === null) return null
  const e = event as {
    id?: unknown
    created?: unknown
    type?: unknown
    data?: {
      sessionID?: unknown
      assistantMessageID?: unknown
      finish?: unknown
      tokens?: unknown
      cost?: unknown
    }
    durable?: { aggregateID?: unknown; seq?: unknown }
    location?: { directory?: unknown }
  }
  if (typeof e.type !== "string" || !USAGE_EVENT_TYPES.has(e.type)) return null
  const data = e.data
  if (typeof data !== "object" || data === null) return null
  const sessionID = data.sessionID
  const tokens = data.tokens
  if (typeof sessionID !== "string" || typeof tokens !== "object" || tokens === null) return null
  const t = tokens as {
    input?: unknown
    output?: unknown
    reasoning?: unknown
    cache?: { read?: unknown; write?: unknown }
  }
  const input = num(t.input)
  const output = num(t.output)
  const reasoning = num(t.reasoning)
  const cacheRead = num(t.cache?.read)
  const cacheWrite = num(t.cache?.write)
  if (input === 0 && output === 0 && reasoning === 0 && cacheRead === 0 && cacheWrite === 0) return null
  return {
    eventID: typeof e.id === "string" ? e.id : "",
    created: typeof e.created === "number" ? e.created : 0,
    durableKey: durableKeyOf(e),
    locationDirectory: typeof e.location?.directory === "string" ? e.location.directory : undefined,
    failed: e.type === "session.step.failed",
    sessionID,
    assistantMessageID: typeof data.assistantMessageID === "string" ? data.assistantMessageID : "",
    finish: typeof data.finish === "string" ? data.finish : undefined,
    tokens: { input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } },
    cost: typeof data.cost === "number" ? data.cost : undefined,
  }
}

/**
 * 计算 durable 事件身份。
 *
 * - 优先 `durable.aggregateID:durable.seq`(跨重发/回放稳定)
 * - 缺 durable 时 fallback 到 `event.id`
 * - 两者皆缺返回空串(调用方视为不去重)
 */
function durableKeyOf(e: {
  id?: unknown
  durable?: { aggregateID?: unknown; seq?: unknown }
}): string {
  const d = e.durable
  if (d && typeof d.aggregateID === "string" && d.aggregateID.length > 0 && typeof d.seq === "number") {
    return `${d.aggregateID}:${d.seq}`
  }
  return typeof e.id === "string" && e.id.length > 0 ? e.id : ""
}

/**
 * 回放过滤判定:事件创建时刻早于插件启动时刻的历史 durable 事件回放 SHALL 被忽略。
 * `created` 缺失(0)视为实时事件(保守累计,不丢弃)。
 *
 * @param created - 事件创建时刻(毫秒时间戳,缺失为 0)
 * @param startTime - 插件启动时刻(毫秒时间戳)
 * @returns true 表示该事件为回放的历史事件,应忽略
 */
export function isReplayedEvent(created: number, startTime: number): boolean {
  return created > 0 && created < startTime
}

/**
 * 位置匹配判定:事件归属位置目录与插件加载位置目录一致时才处理。
 *
 * 背景(见 specs/usage-tracking 按位置过滤):
 * GUI 多位置各加载一份插件实例,`ctx.event.subscribe` 是全局事件流,
 * 每个实例都会收到所有会话的事件——必须按位置过滤,让每个实例只处理
 * 自己位置(目录)的会话,消除跨实例重复计数。
 *
 * `eventLocation` 缺失(无法确定归属)时返回 false,保守丢弃。
 *
 * @param eventLocation - 事件归属位置目录(`event.location.directory`,可能缺失)
 * @param pluginDirectory - 插件加载位置目录(`ctx.location.directory`)
 * @returns true 表示事件属于本插件实例的位置,应处理
 */
export function isLocationMatch(eventLocation: string | undefined, pluginDirectory: string): boolean {
  return typeof eventLocation === "string" && eventLocation.length > 0 && eventLocation === pluginDirectory
}
