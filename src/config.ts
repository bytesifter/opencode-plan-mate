import type { ParsedOptions, ProviderEntry } from "./types"

/** 默认冷却时长(毫秒),请求太快 429 后该 provider 暂时停用 */
const DEFAULT_COOLDOWN_MS = 60000

/** 默认配额耗尽冷却时长(毫秒),配额用完后该 provider 长时间停用 */
const DEFAULT_QUOTA_COOLDOWN_MS = 3600000

/**
 * 解析插件 options:只校验 providers(必填非空)与可选项。
 *
 * @param options - 来自 opencode.jsonc 的 plugin options
 * @returns 解析后的配置(providers + 可选项)
 * @throws providers 缺失/为空/元素非字符串时抛出
 */
export function parseOptions(options: Record<string, unknown> | undefined): ParsedOptions {
  if (!options) {
    throw new Error("opencode-round-robin: 缺少 options")
  }
  const rawProviders = options.providers
  if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
    throw new Error("opencode-round-robin: options.providers 必填且非空")
  }
  const providers: string[] = []
  for (const p of rawProviders) {
    if (typeof p !== "string" || p.length === 0) {
      throw new Error("opencode-round-robin: options.providers 元素必须为非空字符串")
    }
    providers.push(p)
  }
  return {
    providers,
    cooldownMs: typeof options.cooldownMs === "number" ? options.cooldownMs : DEFAULT_COOLDOWN_MS,
    quotaCooldownMs:
      typeof options.quotaCooldownMs === "number" ? options.quotaCooldownMs : DEFAULT_QUOTA_COOLDOWN_MS,
    statsPath: typeof options.statsPath === "string" ? options.statsPath : undefined,
    logPath: typeof options.logPath === "string" ? options.logPath : undefined,
    logDir: typeof options.logDir === "string" ? options.logDir : undefined,
  }
}

/**
 * 从 opencode Config.provider 收集所有指定 provider 的 key + baseURL,返回扁平列表。
 *
 * 不按 baseURL 分组。key 去重(相同 key 只保留第一个)。
 *
 * @param config - opencode Config(config hook 收到)
 * @param providers - 参与轮询的 provider 名列表
 * @returns ProviderEntry[] 扁平列表
 * @throws provider 名不存在或缺 baseURL/apiKey 时抛出
 */
export function collectProviders(
  config: { provider?: Record<string, { options?: { apiKey?: string; baseURL?: string }; models?: Record<string, unknown> }> },
  providers: string[],
): ProviderEntry[] {
  const providerMap = config.provider
  if (!providerMap) {
    throw new Error("opencode-round-robin: Config.provider 为空")
  }
  const seen = new Set<string>()
  const entries: ProviderEntry[] = []
  for (const name of providers) {
    const p = providerMap[name]
    if (!p) {
      throw new Error(`opencode-round-robin: provider "${name}" 不存在于 config.provider`)
    }
    const baseURL = p.options?.baseURL
    const apiKey = p.options?.apiKey
    if (typeof baseURL !== "string" || baseURL.length === 0) {
      throw new Error(`opencode-round-robin: provider "${name}" 缺少 options.baseURL`)
    }
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error(`opencode-round-robin: provider "${name}" 缺少 options.apiKey`)
    }
    if (!seen.has(apiKey)) {
      seen.add(apiKey)
      const models = p.models ? Object.keys(p.models) : []
      entries.push({ key: apiKey, baseURL, account: name, models })
    }
  }
  return entries
}
