/**
 * 插件 options 解析后的完整配置。
 */
export interface ParsedOptions {
  /** 参与轮询的 provider 名(账号名)列表,必填非空 */
  providers: string[]
  /** 全局冷却时长(毫秒),请求太快 429 时生效 */
  cooldownMs: number
  /** 配额耗尽 429 时的冷却时长(毫秒) */
  quotaCooldownMs: number
  /** 统计文件路径(可选,覆盖默认) */
  statsPath?: string
  /** 日志文件路径(可选,覆盖默认,单文件不轮转) */
  logPath?: string
  /** 日志目录路径(可选,启用按日轮转) */
  logDir?: string
}

/**
 * 单个 provider 条目:key + baseURL + 账号名,作为一个整体参与随机轮询。
 */
export interface ProviderEntry {
  /** API key */
  key: string
  /** 该 provider 的 baseURL */
  baseURL: string
  /** 账号名(provider 名,用于日志) */
  account: string
  /** 该 provider 支持的模型名列表(从 config.models 的 key 提取) */
  models: string[]
}

/**
 * 单个 provider 的统计项(一天内累计)。
 */
export interface ProviderStats {
  /** 请求数 */
  req: number
  /** 输入 token */
  in: number
  /** 输出 token */
  out: number
  /** 推理 token */
  reasoning: number
  /** 缓存读 token */
  cacheRead: number
  /** 缓存写 token */
  cacheWrite: number
  /** 费用 */
  cost: number
}

/**
 * 统计存储:以日期(YYYY-MM-DD)为 key,每天下按 provider 名为 key。
 */
export type StatsStore = Record<string, Record<string, ProviderStats>>

/** 日志级别 */
export type LogLevel = "INFO" | "WARN" | "ERROR"

/**
 * event 层业务上下文(从 message.updated 事件提取)。
 */
export interface EventContext {
  /** sessionID 截短为前 8 位(隐私保护) */
  sessionID?: string
  /** 模型 ID(如 glm-5.2) */
  modelID?: string
  /** provider ID(如 volxc9208) */
  providerID?: string
  /** 模式(如 code/plan) */
  mode?: string
  /** agent 名 */
  agent?: string
  /** 消息耗时(毫秒,从 time.completed - time.created 计算) */
  durationMs?: number
}
