#!/usr/bin/env bun
/**
 * arkcli 多账号 SSO 登录工具脚本。
 *
 * 读取 opencode.jsonc 的 plugin[].planStats.accounts(显示名 → 独立 arkcli HOME),
 * 每次执行全量清空各账号 HOME 后逐账号完成火山 SSO 登录(--no-browser 跨设备流),
 * 登录后做 coding-plan profile 兜底与 usage plan 验证。
 *
 * 用法:
 *   bun scripts/login-arkcli-accounts.ts                  # 默认读 opencode.jsonc
 *   bun scripts/login-arkcli-accounts.ts --config <path>  # 指定配置文件
 *   bun scripts/login-arkcli-accounts.ts --dry-run        # 只打印清单,不登录
 *   bun scripts/login-arkcli-accounts.ts --help
 */
import { parse, type ParseError } from "jsonc-parser"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { rmSync, readFileSync, existsSync } from "node:fs"
import { createInterface } from "node:readline"

/** 账号清单:显示名 → 独立 arkcli HOME 目录 */
export interface AccountEntry {
  name: string
  home: string
}

/** 子进程执行结果 */
interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

/** 逐账号登录结果 */
export interface LoginResult {
  name: string
  home: string
  ok: boolean
  error?: string
}

/** arkcli 子进程超时(毫秒) */
const EXEC_TIMEOUT_MS = 60000

/** 默认配置文件路径 */
const DEFAULT_CONFIG = "opencode.jsonc"

/** 用户 home 目录展开缓存 */
let cachedHomeDir: string | undefined

/** 脚本自管目录标记:home 路径含此片段视为被污染(历史手工登录残留) */
const POLLUTION_MARKER = ".arkcli-accounts"

/**
 * 可信用户 home 目录。
 *
 * Windows 上 home 主要来自 `USERPROFILE` env,而该 env 可能被历史手工登录污染成
 * 嵌套路径(如 `...\.arkcli-accounts\volhwy2410\.arkcli-accounts\account-a\...`)。
 * 若候选 home 含 `.arkcli-accounts` 片段(脚本自管目录标记),判定为污染,回退到:
 *   1. `HOMEDRIVE + HOMEPATH`(实测在 USERPROFILE 被污染时仍保持干净)
 *   2. 兜底 `C:\Users\<USERNAME>`
 *
 * 候选 home 解析顺序:显式 env.USERPROFILE(Windows 惯例) → os.homedir()。
 * 传入 env 便于单测注入污染场景。
 */
export function trustedHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const candidate = env.USERPROFILE || homedir()
  if (!candidate.includes(POLLUTION_MARKER)) return candidate
  const drive = env.HOMEDRIVE
  const path = env.HOMEPATH
  if (drive && path) return join(drive, path)
  const user = env.USERNAME
  if (user) return `C:\\Users\\${user}`
  return candidate
}

/** 展开 `~` 前缀为用户 home 目录(兼容 `~/` 与 Windows 写法 `~\`) */
export function expandHome(p: string): string {
  if (!cachedHomeDir) cachedHomeDir = trustedHomeDir()
  if (p === "~") return cachedHomeDir
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(cachedHomeDir, p.slice(2))
  return p
}

/**
 * 校验账号 HOME 是否含嵌套 `.arkcli-accounts` 片段(污染残留)。
 *
 * 注意:合法的单账号 HOME 形如 `...\.arkcli-accounts\volxc9208`,其末尾账号名不含
 * 该片段,因此完整路径中只应出现一次标记;出现 >1 次即嵌套。
 */
export function hasNestedPollution(home: string): boolean {
  const parts = home.split(/[\\/]/).filter((s) => s.length > 0)
  return parts.filter((s) => s.includes(POLLUTION_MARKER)).length > 1
}

/**
 * 全量清空账号根目录(消除历史嵌套残留与旧登录态)。
 *
 * 每次启动执行,确保登录前环境干净、不残留任何嵌套 `.arkcli-accounts` 分支。
 *
 * @param homeRoot - 账号根目录(如 `~/.arkcli-accounts`)
 * @returns 失败时返回错误信息;成功返回 undefined
 */
export function resetAccountRoot(homeRoot: string): string | undefined {
  try {
    rmSync(homeRoot, { recursive: true, force: true })
    return undefined
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * 按平台构造子进程执行计划(纯函数,便于跨平台单测)。
 *
 * Windows 上 arkcli 以 `.cmd`/`.bat` 垫片分发:npm 垫片既无法被无 shell 的 spawn
 * 按 PATHEXT 解析(Node 不补后缀 → ENOENT),直接写 `arkcli.cmd` 又会被 Node≥18 拒绝
 * (EINVAL)。故 Windows 走命令解释器 `cmd.exe /c` 解析垫片;POSIX 原样直接执行。
 */
export function buildSpawn(
  platform: NodeJS.Platform,
  cmd: string,
  args: string[],
): { file: string; args: string[] } {
  if (platform === "win32") {
    return { file: process.env.ComSpec ?? "cmd.exe", args: ["/c", cmd, ...args] }
  }
  return { file: cmd, args }
}

/**
 * 从配置文本抽取 plugin 条目中的 planStats.accounts 账号映射。
 *
 * opencode.jsonc 的 `plugin` 为数组:元素要么是插件名字符串,要么是 `[name, options]`
 * 二元数组。遍历所有元素,收集 options.planStats.accounts 非空的映射。
 *
 * @param text - 配置文件原文(允许 JSONC 注释/尾逗号)
 * @returns 账号清单;找不到有效配置时返回空数组
 */
export function extractAccounts(text: string): AccountEntry[] {
  const errors: ParseError[] = []
  const root = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0) return []
  const plugin = (root as { plugin?: unknown } | null)?.plugin
  if (!Array.isArray(plugin)) return []

  const out: AccountEntry[] = []
  for (const item of plugin) {
    if (!Array.isArray(item) || item.length < 2) continue
    const options = item[1] as { planStats?: { accounts?: Record<string, unknown> } } | null
    const accounts = options?.planStats?.accounts
    if (!accounts || typeof accounts !== "object") continue
    for (const [name, home] of Object.entries(accounts)) {
      if (typeof name !== "string" || name.length === 0) continue
      if (typeof home !== "string" || home.length === 0) continue
      out.push({ name, home: expandHome(home) })
    }
  }
  return out
}

/**
 * 解析配置文件路径并抽取账号清单。
 *
 * @param configPath - 配置文件路径(默认 opencode.jsonc)
 * @returns 账号清单
 * @throws 文件不存在或解析失败
 */
export function parseAccounts(configPath: string = DEFAULT_CONFIG): AccountEntry[] {
  if (!existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`)
  }
  const text = readFileSync(configPath, "utf8")
  const accounts = extractAccounts(text)
  if (accounts.length === 0) {
    throw new Error(`配置文件中未找到 planStats.accounts(文件: ${configPath})`)
  }
  return accounts
}

/**
 * 执行外部命令,收集 stdout/stderr,超时 kill。
 *
 * env 同时注入 `HOME` 与 `USERPROFILE`:POSIX 认 HOME,Windows 认 USERPROFILE,
 * 双设覆盖两平台。
 */
export function exec(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const plan = buildSpawn(process.platform, cmd, args)
    const child = spawn(plan.file, plan.args, {
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined
    child.on("error", (err: NodeJS.ErrnoException) => {
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

/** 以指定账号隔离 HOME 执行 arkcli 命令 */
export function execArkcli(
  args: string[],
  home: string,
  opts: { timeoutMs?: number } = {},
): Promise<ExecResult> {
  return exec("arkcli", args, {
    env: { HOME: home, USERPROFILE: home },
    timeoutMs: opts.timeoutMs ?? EXEC_TIMEOUT_MS,
  })
}

/**
 * auth login phase1 参数。显式 --login-mode legacy:stdout 返回含 authorize_url 的
 * JSON 并立即退出;默认 auto 的 broker 链路在非交互管道下会阻塞等待本地回调。
 */
export function loginPhase1Args(): string[] {
  return ["auth", "login", "--no-browser", "--login-mode", "legacy"]
}

/** auth login phase2 参数:喂回浏览器显示的 base64 授权码完成登录 */
export function loginPhase2Args(code: string): string[] {
  return ["auth", "login", "--no-browser", "--login-mode", "legacy", "--code", code]
}

/** 解析 auth login --no-browser 的 stdout JSON,取 authorize_url */
export function parseAuthorizeUrl(stdout: string): string | undefined {
  try {
    const data = JSON.parse(stdout) as { authorize_url?: string; stage?: string }
    if (typeof data.authorize_url === "string" && data.authorize_url.length > 0) {
      return data.authorize_url
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 用系统默认浏览器打开 URL;失败回退打印 URL 供手动打开。
 *
 * 子进程注入 `HOME` 与 `USERPROFILE` = 可信真实用户 home:阻断脚本进程被污染的
 * USERPROFILE 被浏览器继承、把缓存写进错误路径;同时避免浏览器 WinINet 缓存(含
 * 受保护 ACL 的 Content.IE5)写入账号独立 HOME。
 */
export function openURL(url: string): void {
  try {
    const plan = buildOpenPlanEnv(process.platform, url, process.env)
    spawn(plan.file, plan.args, { stdio: "ignore", env: plan.env })
  } catch {
    console.log(`无法自动打开浏览器,请手动访问:\n${url}`)
  }
}

/**
 * 构造浏览器子进程执行计划(含注入 env,纯函数便于跨平台单测)。
 *
 * 返回 spawn 所需的 file/args/env;env 在进程原有环境基础上把 HOME 与 USERPROFILE
 * 覆盖为可信真实用户 home(污染回退后),阻断被污染的进程环境被浏览器继承;浏览器
 * 的 WinINet 缓存因此写入真实 profile,而非账号独立 HOME。
 */
export function buildOpenPlanEnv(
  platform: NodeJS.Platform,
  url: string,
  env: NodeJS.ProcessEnv = {},
): { file: string; args: string[]; env: NodeJS.ProcessEnv } {
  const plan = buildOpenPlan(platform, url)
  const home = trustedHomeDir(env)
  return { file: plan.file, args: plan.args, env: { ...env, HOME: home, USERPROFILE: home } }
}

/**
 * 构造打开默认浏览器的子进程执行计划(纯函数,便于跨平台单测)。
 *
 * Windows 不用 cmd 内建 `start`:cmd 会把 `&` 当命令分隔符、`%XX` 当变量展开,
 * 截断/拆散 authorize_url(实测 redirect_uri 参数丢失 → 火山 SSO ParameterError)。
 * rundll32 的 url.dll 直接收 argv 打开默认浏览器,不经过 cmd 解析,URL 保持完整。
 */
export function buildOpenPlan(
  platform: NodeJS.Platform,
  url: string,
): { file: string; args: string[] } {
  if (platform === "win32") {
    return { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
  }
  if (platform === "darwin") {
    return { file: "open", args: [url] }
  }
  return { file: "xdg-open", args: [url] }
}

/** 从 stdin 读取一行(粘贴 base64 授权码) */
export function promptLine(promptText: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(promptText, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/** 判断某账号 HOME 下是否已有 coding-plan 类型 profile */
export async function hasCodingPlanProfile(home: string): Promise<boolean> {
  const res = await execArkcli(["auth", "status"], home)
  if (res.exitCode !== 0) return false
  try {
    const data = JSON.parse(res.stdout) as { active_profile?: { type?: string } }
    return data.active_profile?.type === "coding-plan"
  } catch {
    return false
  }
}

/**
 * 登录后 profile 兜底:无 coding-plan 默认 profile 时创建。
 *
 * 登录本身可能自动建 profile(实测实例登录后自动生成 coding-plan profile),
 * 因此先探测,没有才兜底创建。
 */
export async function ensureCodingPlanProfile(home: string): Promise<string | undefined> {
  if (await hasCodingPlanProfile(home)) return undefined
  const res = await execArkcli(
    ["profile", "create", "--name", "default", "--type", "coding-plan", "--region", "cn-beijing", "--set-default", "--no-interactive"],
    home,
  )
  if (res.exitCode !== 0) {
    return `profile 兜底失败: ${firstLine(res.stderr || res.stdout)}`
  }
  return undefined
}

/** 校验某账号能取到 coding-plan 配额(含 percent 即成功) */
export async function verifyAccount(home: string): Promise<string | undefined> {
  const res = await execArkcli(
    ["usage", "plan", "--product", "coding-plan", "--format", "json"],
    home,
  )
  if (res.exitCode !== 0) {
    return `验证失败: ${firstLine(res.stderr || res.stdout)}`
  }
  if (!/percent/.test(res.stdout)) {
    return "验证失败: 未返回 percent 数据"
  }
  return undefined
}

/**
 * 单个账号完整登录:删 HOME → 发起授权 → 打开浏览器 → 贴码完成 → profile 兜底 → 验证。
 */
export async function loginAccount(name: string, home: string): Promise<LoginResult> {
  try {
    rmSync(home, { recursive: true, force: true })

    const phase1 = await execArkcli(loginPhase1Args(), home)
    if (phase1.exitCode !== 0) {
      return { name, home, ok: false, error: `发起授权失败: ${firstLine(phase1.stderr || phase1.stdout)}` }
    }
    const url = parseAuthorizeUrl(phase1.stdout)
    if (!url) {
      return { name, home, ok: false, error: "未能解析 authorize_url" }
    }
    openURL(url)
    const code = await promptLine(`[${name}] 请在浏览器完成授权后,粘贴 base64 授权码: `)
    if (!code) {
      return { name, home, ok: false, error: "未输入授权码" }
    }

    const phase2 = await execArkcli(loginPhase2Args(code), home)
    if (phase2.exitCode !== 0) {
      return { name, home, ok: false, error: `完成登录失败: ${firstLine(phase2.stderr || phase2.stdout)}` }
    }

    const profileErr = await ensureCodingPlanProfile(home)
    if (profileErr) {
      return { name, home, ok: false, error: profileErr }
    }

    const verifyErr = await verifyAccount(home)
    if (verifyErr) {
      return { name, home, ok: false, error: verifyErr }
    }

    return { name, home, ok: true }
  } catch (err) {
    return { name, home, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 取非空首行(用于错误摘要) */
function firstLine(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0)
  return line ? line.slice(0, 200) : "未知错误"
}

/** 渲染逐账号进度(打勾 + 结果) */
export function renderProgress(results: LoginResult[]): string {
  const lines = results.map((r) => {
    const mark = r.ok ? "✓" : "✗"
    const detail = r.ok ? "登录成功" : r.error ?? "失败"
    return `${mark} ${r.name} (${r.home}) — ${detail}`
  })
  const okCount = results.filter((r) => r.ok).length
  lines.push(`\n成功 ${okCount}/${results.length}`)
  return lines.join("\n")
}

/** 主流程参数 */
interface CliArgs {
  config: string
  dryRun: boolean
}

/** 解析命令行参数 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { config: DEFAULT_CONFIG, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--help" || a === "-h") {
      args.dryRun = true
    } else if (a === "--dry-run") {
      args.dryRun = true
    } else if (a === "--config") {
      args.config = argv[++i] ?? args.config
    } else if (a.startsWith("--config=")) {
      args.config = a.slice("--config=".length)
    }
  }
  return args
}

/** 打印帮助 */
function printHelp(): void {
  console.log(`用法:
  bun scripts/login-arkcli-accounts.ts                 默认读 opencode.jsonc
  bun scripts/login-arkcli-accounts.ts --config <path> 指定配置文件
  bun scripts/login-arkcli-accounts.ts --dry-run       只打印清单,不登录
  bun scripts/login-arkcli-accounts.ts --help          显示本帮助
`)
}

/** 主入口 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv)
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp()
    return 0
  }

  let accounts: AccountEntry[]
  try {
    accounts = parseAccounts(args.config)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const polluted = accounts.filter((a) => hasNestedPollution(a.home))
  if (polluted.length > 0) {
    console.error(`检测到账号 HOME 存在嵌套 .arkcli-accounts 路径(疑似污染残留),已中止:`)
    for (const a of polluted) {
      console.error(`  ${a.name} -> ${a.home}`)
    }
    console.error(`请先清理嵌套目录(如 Remove-Item "$env:USERPROFILE\.arkcli-accounts" -Recurse -Force)或修正配置后重试。`)
    return 1
  }

  // 每次启动全量清空账号根目录(消除历史嵌套残留与旧登录态),再逐账号重登
  const homeRoot = dirname(accounts[0].home)
  if (args.dryRun) {
    console.log(`[dry-run] 将清空账号根目录 ${homeRoot} 并全量重登 (config: ${args.config}):`)
  } else {
    const err = resetAccountRoot(homeRoot)
    if (err) {
      console.error(`清空账号根目录失败: ${err}`)
      return 1
    }
    console.log(`已清空账号根目录: ${homeRoot}`)
  }

  if (args.dryRun) {
    console.log(`将按以下账号执行全量重登:`)
    for (const a of accounts) {
      console.log(`  ${a.name} -> ${a.home}`)
    }
    return 0
  }

  console.log(`开始登录 ${accounts.length} 个账号 (config: ${args.config}):`)
  const results: LoginResult[] = []
  for (const a of accounts) {
    console.log(`\n=== ${a.name} ===`)
    results.push(await loginAccount(a.name, a.home))
  }

  console.log("\n" + renderProgress(results))
  return results.every((r) => r.ok) ? 0 : 1
}

// bun 直跑时进入主流程(被 import 测试时不执行)
if (import.meta.main) {
  process.exit(await main())
}
