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
  /** 统计目录路径(可选,覆盖默认,按日 JSONL) */
  statsDir?: string
  /** 日志文件路径(可选,覆盖默认,单文件不轮转) */
  logPath?: string
  /** 日志目录路径(可选,启用按日轮转) */
  logDir?: string
  /** plan_stats 配置(可选):参与官方套餐配额统计的账号映射(显示名 → 独立 arkcli HOME 目录) */
  planStats?: { accounts: Record<string, string> }
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

/**
 * JSONL 一行:一条增量记录(自包含,可独立聚合)。
 * 数值为该条记录的增量(非累计值),聚合时逐字段求和。
 */
export interface StatsRecord {
  day: string
  provider: string
  req: number
  in: number
  out: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

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

/**
 * 单个套餐配额窗口(官方后端只返 percent,无 used/total 绝对值)。
 */
export interface PlanPeriod {
  /** 窗口标签:CodingPlan 为 session / weekly / monthly */
  label: string
  /** 已用百分比 0-100 */
  percent: number
  /** 下次刷新时间(RFC3339,UTC+8) */
  resetAt?: string
}

/**
 * 一个 profile 的官方套餐配额聚合结果(与 provider 无关的统一模型)。
 */
export interface PlanQuota {
  /** profile 名(行名) */
  provider: string
  /** 套餐类型(如 coding-plan,未来可扩展 agent-plan / seat...) */
  kind: string
  /** 是否持有该套餐 */
  subscribed: boolean
  /** 各窗口配额(按 label 索引时以首次出现为准) */
  periods: PlanPeriod[]
  /** 数据更新时间(CodingPlan 后端提供) */
  updatedAt?: string
  /** 失败/跳过原因(有值表示该行无可用数据) */
  error?: string
}

/**
 * 子进程执行结果。
 */
export interface SpawnResult {
  stdout: string
  stderr: string
  /** 退出码;null 表示命令无法启动(如 ENOENT)或被杀 */
  exitCode: number | null
}

/**
 * 子进程执行器:adapter 通过它运行外部命令,测试时注入 fake。
 */
export type SpawnExecutor = (
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number },
) => Promise<SpawnResult>

/**
 * provider 无关的套餐配额取数适配器。
 */
export interface QuotaAdapter {
  /** 适配器标识(如 volc-arkcli) */
  id: string
  /** 是否支持某账号(首个实现默认全支持) */
  supports(account: string): boolean
  /** 取数:以该账号隔离的 arkcli HOME 执行查询,返回官方配额 */
  fetch(account: string, home: string, exec: SpawnExecutor): Promise<PlanQuota>
}
