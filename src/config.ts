import type { ParsedOptions, ProviderEntry } from "./types"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"

/** 默认冷却时长(毫秒),请求太快 429 后该 provider 暂时停用 */
const DEFAULT_COOLDOWN_MS = 60000

/** 默认配额耗尽冷却时长(毫秒),配额用完后该 provider 长时间停用 */
const DEFAULT_QUOTA_COOLDOWN_MS = 3600000

/** 全局配置文件名(opencode 配置文件,含注释与尾逗号) */
const CONFIG_FILENAMES = ["opencode.json", "opencode.jsonc"] as const

/**
 * 解析插件 options:只校验 providers(必填非空)与可选项。
 *
 * v2 下 options 来自 `{package, options}` 对象,经 `ctx.options` 传入 setup。
 *
 * @param options - 来自 opencode.jsonc 的 plugin options
 * @returns 解析后的配置(providers + 可选项)
 * @throws providers 缺失/为空/元素非字符串时抛出
 */
export function parseOptions(options: Record<string, unknown> | undefined): ParsedOptions {
  if (!options) {
    throw new Error("opencode-plan-mate: 缺少 options")
  }
  const rawProviders = options.providers
  if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
    throw new Error("opencode-plan-mate: options.providers 必填且非空")
  }
  const providers: string[] = []
  for (const p of rawProviders) {
    if (typeof p !== "string" || p.length === 0) {
      throw new Error("opencode-plan-mate: options.providers 元素必须为非空字符串")
    }
    providers.push(p)
  }
  return {
    providers,
    cooldownMs: typeof options.cooldownMs === "number" ? options.cooldownMs : DEFAULT_COOLDOWN_MS,
    quotaCooldownMs:
      typeof options.quotaCooldownMs === "number" ? options.quotaCooldownMs : DEFAULT_QUOTA_COOLDOWN_MS,
    statsDir: typeof options.statsDir === "string" ? options.statsDir : undefined,
    logPath: typeof options.logPath === "string" ? options.logPath : undefined,
    logDir: typeof options.logDir === "string" ? options.logDir : undefined,
    planStats: parsePlanStats(options.planStats),
  }
}

/**
 * 解析可选 `planStats` 配置(多账号形态:显示名 → 独立 arkcli HOME 目录映射)。
 * 过滤 key/value 非空字符串的项;支持 `~` 前缀展开(homedir);结果为空映射时视为未配置(返回 undefined)。
 */
function parsePlanStats(raw: unknown): { accounts: Record<string, string> } | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const accounts = (raw as { accounts?: unknown }).accounts
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) return undefined
  const out: Record<string, string> = {}
  for (const [name, home] of Object.entries(accounts as Record<string, unknown>)) {
    if (typeof name !== "string" || name.length === 0) continue
    if (typeof home !== "string" || home.length === 0) continue
    out[name] = expandHome(home)
  }
  if (Object.keys(out).length === 0) return undefined
  return { accounts: out }
}

/** 展开 `~` 前缀为用户 home 目录(兼容 `~/` 与 Windows 习惯写法 `~\`) */
function expandHome(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2))
  return p
}

/**
 * opencode 配置文件里 provider 段的结构(兼容 v2 的 provider 定义)。
 */
export interface ProviderConfigSection {
  provider?: Record<string, { options?: { apiKey?: string; baseURL?: string }; models?: Record<string, unknown> }>
}

/**
 * 读取并解析 opencode 配置文件(JSONC)的 provider 段。
 *
 * v2 不再通过 config hook 暴露合并后的 Config,v2 的 provider 元数据(`ctx.provider`)
 * 也不含 apiKey(属凭证/连接层)。因此参与轮询的 provider 定义(含 apiKey/baseURL/models)
 * 直接从配置文件读取(全局 + 插件所在位置的配置,项目级覆盖全局)。
 *
 * @param paths - 候选配置文件路径(按优先级,后读的覆盖先读的同名 provider)
 * @returns 合并后的 provider 段;解析失败返回空对象(不抛错,由 collectProviders 报 provider 缺失)
 */
export function loadProviderConfig(paths: string[]): ProviderConfigSection {
  const merged: ProviderConfigSection = { provider: {} }
  for (const file of paths) {
    if (!existsSync(file)) continue
    let root: unknown
    try {
      root = parse(readFileSync(file, "utf8"))
    } catch {
      continue
    }
    const section = root as ProviderConfigSection | null
    if (!section || typeof section !== "object" || !section.provider || typeof section.provider !== "object") continue
    for (const [name, def] of Object.entries(section.provider)) {
      if (def && typeof def === "object") merged.provider![name] = def
    }
  }
  return merged
}

/**
 * 生成候选配置文件路径:全局配置目录 + 插件所在位置,后读覆盖先读。
 *
 * @param globalConfigDir - 全局配置目录(如 ~/.config/opencode)
 * @param locationDir - 插件加载位置目录(如项目根)
 */
export function configFileCandidates(globalConfigDir: string, locationDir?: string): string[] {
  const globalFiles = CONFIG_FILENAMES.map((f) => join(globalConfigDir, f))
  const locationFiles = locationDir ? CONFIG_FILENAMES.map((f) => join(locationDir, f)) : []
  // 项目级在后,同名 provider 覆盖全局
  return [...globalFiles, ...locationFiles]
}

/**
 * 从 opencode 配置文件收集所有指定 provider 的 key + baseURL,返回扁平列表。
 *
 * 不按 baseURL 分组。key 去重(相同 key 只保留第一个)。
 *
 * @param config - 合并后的 provider 段(loadProviderConfig 结果)
 * @param providers - 参与轮询的 provider 名列表
 * @returns ProviderEntry[] 扁平列表
 * @throws provider 名不存在或缺 baseURL/apiKey 时抛出
 */
export function collectProviders(
  config: ProviderConfigSection,
  providers: string[],
): ProviderEntry[] {
  const providerMap = config.provider
  if (!providerMap) {
    throw new Error("opencode-plan-mate: Config.provider 为空")
  }
  const seen = new Set<string>()
  const entries: ProviderEntry[] = []
  for (const name of providers) {
    const p = providerMap[name]
    if (!p) {
      throw new Error(`opencode-plan-mate: provider "${name}" 不存在于 config.provider`)
    }
    const baseURL = p.options?.baseURL
    const apiKey = p.options?.apiKey
    if (typeof baseURL !== "string" || baseURL.length === 0) {
      throw new Error(`opencode-plan-mate: provider "${name}" 缺少 options.baseURL`)
    }
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error(`opencode-plan-mate: provider "${name}" 缺少 options.apiKey`)
    }
    if (!seen.has(apiKey)) {
      seen.add(apiKey)
      const models = p.models ? Object.keys(p.models) : []
      entries.push({ key: apiKey, baseURL, account: name, models })
    }
  }
  return entries
}
