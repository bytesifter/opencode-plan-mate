import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import type { LogLevel, EventContext } from "./types"

/** token 用量(用于 event 层日志) */
export interface UsageTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

/**
 * 结构化请求日志:支持日志级别、按日轮转、业务上下文。
 *
 * 设计要点(见 design 决策 2、3、4):
 * - KV 格式可读性好且可 grep,非 JSON
 * - logDir 启用按日轮转,logPath 单文件追加(向后兼容)
 * - key 脱敏:只记序号与末 4 位,禁止明文
 */
export class Logger {
  private readonly mode: "simple" | "rotation"
  private readonly dir: string
  private readonly fixedPath: string

  constructor(logDirOrPath: string, opts: { rotation?: boolean } = {}) {
    if (opts.rotation) {
      this.mode = "rotation"
      this.dir = logDirOrPath
      this.fixedPath = ""
      mkdirSync(this.dir, { recursive: true })
    } else {
      this.mode = "simple"
      this.dir = ""
      this.fixedPath = logDirOrPath
      mkdirSync(dirname(this.fixedPath), { recursive: true })
    }
  }

  /**
   * 记录一次匹配 pool 的请求(fetch 层,响应后)。
   *
   * @param accountName - 账号名(provider 名)
   * @param keyIndex - key 序号
   * @param keyTail - key 末 4 位(已脱敏)
   * @param status - HTTP 状态码
   * @param durationMs - 请求耗时(毫秒)
   */
  logFetch(accountName: string, keyIndex: number, keyTail: string, status: number, durationMs: number): void {
    const level = statusLevel(status)
    const line = `${nowStr()} ${level.padEnd(5)} fetch provider=${accountName} key=#${keyIndex}(${keyTail}) status=${status} duration=${durationMs}ms\n`
    this.write(line)
  }

  /**
   * 记录 429 冷却事件。
   *
   * @param accountName - 账号名
   * @param keyIndex - key 序号
   * @param keyTail - key 末 4 位(已脱敏)
   * @param type - 冷却类型(rate-limit / quota-exhausted)
   * @param cooldownMs - 冷却时长(毫秒)
   */
  logCooldown(
    accountName: string,
    keyIndex: number,
    keyTail: string,
    type: "rate-limit" | "quota-exhausted",
    cooldownMs: number,
  ): void {
    const line = `${nowStr()} WARN  cooldown provider=${accountName} key=#${keyIndex}(${keyTail}) ${type} ${cooldownMs}ms\n`
    this.write(line)
  }

  /**
   * 记录一次消息完成的 token 用量(event 层)。
   *
   * @param tokens - 各分量 token 数
   * @param cost - 费用
   * @param ctx - 业务上下文(session/model/mode/agent/duration)
   */
  logUsage(tokens: UsageTokens, cost: number, ctx?: EventContext): void {
    const parts = [
      `in=${tokens.input}`,
      `out=${tokens.output}`,
      `reasoning=${tokens.reasoning}`,
      `cacheR=${tokens.cache.read}`,
      `cacheW=${tokens.cache.write}`,
      `cost=${cost}`,
    ]
    if (ctx) {
      if (ctx.sessionID) parts.push(`session=${ctx.sessionID}`)
      if (ctx.modelID) parts.push(`model=${ctx.modelID}`)
      if (ctx.providerID) parts.push(`provider=${ctx.providerID}`)
      if (ctx.mode) parts.push(`mode=${ctx.mode}`)
      if (ctx.agent) parts.push(`agent=${ctx.agent}`)
      if (ctx.durationMs !== undefined) parts.push(`duration=${ctx.durationMs}ms`)
    }
    const line = `${nowStr()} INFO  usage ${parts.join(" ")}\n`
    this.write(line)
  }

  private write(line: string): void {
    if (this.mode === "rotation") {
      const day = todayLocal()
      appendFileSync(join(this.dir, `round-robin-${day}.log`), line)
    } else {
      appendFileSync(this.fixedPath, line)
    }
  }
}

/** 根据 HTTP 状态码选择日志级别 */
function statusLevel(status: number): LogLevel {
  if (status === 429 || status === 402) return "WARN"
  if (status >= 500) return "ERROR"
  return "INFO"
}

/** key 脱敏:仅保留末 4 位 */
export function tail(key: string): string {
  return key.length > 4 ? ".." + key.slice(-4) : key
}

/** 当前时间字符串(YYYY-MM-DD HH:MM:SS.mmm,本地时区) */
function nowStr(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** 本地日期 YYYY-MM-DD(按本地时区) */
function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
