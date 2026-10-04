#!/usr/bin/env bun
/**
 * arkcli 多账号 SSO 登录工具脚本。
 *
 * 读取 opencode.jsonc 的 plugin[].planStats.accounts(显示名 → 独立 arkcli HOME),
 * 默认增量:先逐账号 `auth status` 探测,仅对过期/未登录/缺失的账号清空其 HOME 并重登
 * (--no-browser 跨设备流);有效账号跳过。`--force` 恢复旧全量清空重登。
 * 登录后做 coding-plan profile 兜底与 usage plan 验证。
 *
 * 用法:
 *   bun scripts/login-arkcli-accounts.ts                         # 默认增量,读 opencode.jsonc
 *   bun scripts/login-arkcli-accounts.ts --config <path>         # 指定配置文件
 *   bun scripts/login-arkcli-accounts.ts --dry-run               # 只打印分类计划,不登录
 *   bun scripts/login-arkcli-accounts.ts --force                 # 全量清空后重登全部账号
 *   bun scripts/login-arkcli-accounts.ts --only <name>           # 只处理指定账号
 *   bun scripts/login-arkcli-accounts.ts --browser normal        # 普通模式打开(默认隐身)
 *   bun scripts/login-arkcli-accounts.ts --code-input manual     # 强制手工粘贴(默认剪贴板捕获)
 *   bun scripts/login-arkcli-accounts.ts --help
 */
import { parse, type ParseError } from "jsonc-parser"
import { spawn, execSync } from "node:child_process"
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

/** Phase 1 authorize_url 有效期(秒 → 毫秒);剪贴板轮询默认超时上限 */
const PHASE1_TTL_MS = 600_000

/** local-callback 流(arkcli auto 模式本地回调)超时:等用户在浏览器授权 + 回调 */
const LOCAL_CALLBACK_TIMEOUT_MS = 600_000

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
 * 从配置文本抽取插件条目中的 planStats.accounts 账号映射。
 *
 * 兼容两种配置形态:
 * - v2 `plugins` 数组:元素为插件名/路径字符串,或 `{"package": ..., "options": {...}}` 对象
 * - v1 `plugin` 数组:元素为插件名字符串,或 `[name, options]` 二元数组(迁移过渡期兼容)
 *
 * 遍历所有元素,收集 options.planStats.accounts 非空的映射。
 *
 * @param text - 配置文件原文(允许 JSONC 注释/尾逗号)
 * @returns 账号清单;找不到有效配置时返回空数组
 */
export function extractAccounts(text: string): AccountEntry[] {
  const errors: ParseError[] = []
  const root = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0) return []

  const out: AccountEntry[] = []
  const collect = (options: unknown): void => {
    const accounts = (options as { planStats?: { accounts?: Record<string, unknown> } } | null)?.planStats?.accounts
    if (!accounts || typeof accounts !== "object") return
    for (const [name, home] of Object.entries(accounts)) {
      if (typeof name !== "string" || name.length === 0) continue
      if (typeof home !== "string" || home.length === 0) continue
      out.push({ name, home: expandHome(home) })
    }
  }

  // v2:plugins 数组(字符串条目无 options,跳过;对象条目读 options)
  const plugins = (root as { plugins?: unknown } | null)?.plugins
  if (Array.isArray(plugins)) {
    for (const item of plugins) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue
      const entry = item as { package?: unknown; options?: unknown }
      collect(entry.options)
    }
  }

  // v1:plugin 数组(元组形态兼容,迁移过渡期)
  const plugin = (root as { plugin?: unknown } | null)?.plugin
  if (Array.isArray(plugin)) {
    for (const item of plugin) {
      if (!Array.isArray(item) || item.length < 2) continue
      collect(item[1])
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
 * 用系统默认浏览器打开 URL(默认隐身模式,`mode="normal"` 强制普通模式);
 * 失败回退打印 URL 供手动打开。
 *
 * 子进程注入 `HOME` 与 `USERPROFILE` = 可信真实用户 home:阻断脚本进程被污染的
 * USERPROFILE 被浏览器继承、把缓存写进错误路径;同时避免浏览器 WinINet 缓存(含
 * 受保护 ACL 的 Content.IE5)写入账号独立 HOME。
 */
export function openURL(url: string, mode: "incognito" | "normal" = "incognito"): void {
  try {
    const plan =
      mode === "incognito" ? buildIncognitoPlanFor(process.platform, url, process.env) : buildOpenPlan(process.platform, url)
    const full = injectTrustedHome(process.platform, plan, process.env)
    spawn(full.file, full.args, { stdio: "ignore", env: full.env })
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
  return injectTrustedHome(platform, buildOpenPlan(platform, url), env)
}

/** 把 HOME/USERPROFILE 注入为可信真实用户 home(纯函数,供各打开计划复用) */
export function injectTrustedHome(
  platform: NodeJS.Platform,
  plan: { file: string; args: string[] },
  env: NodeJS.ProcessEnv = {},
): { file: string; args: string[]; env: NodeJS.ProcessEnv } {
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

// ===== 隐身浏览器:探测 + flag + 回退 =====

/** 浏览器标识 */
export type BrowserId = "chrome" | "edge" | "firefox" | "unknown"

/** 从 Windows UserChoice ProgId 映射浏览器标识(纯函数) */
export function browserIdFromProgId(progId: string): BrowserId {
  const p = progId.toLowerCase()
  if (p.includes("chrome")) return "chrome"
  if (p.includes("edge")) return "edge"
  if (p.includes("firefox")) return "firefox"
  return "unknown"
}

/**
 * 探测默认浏览器(Windows 读注册表 UserChoice→ProgId;macOS/Linux 暂不探测,
 * 由 buildIncognitoPlan 用常见可执行名 + spawn 失败回退)。
 */
export function detectDefaultBrowser(
  platform: NodeJS.Platform,
  _env: NodeJS.ProcessEnv = process.env,
): BrowserId {
  if (platform !== "win32") return "unknown"
  try {
    const out = execSync(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" /v ProgId`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
    const m = out.match(/ProgId\s+REG_SZ\s+(.+)/)
    return browserIdFromProgId(m?.[1] ?? "")
  } catch {
    return "unknown"
  }
}

/** Windows 浏览器可执行文件候选路径(按环境变量 ProgramFiles/(x86)/LocalAppData 展开) */
export function winBrowserExeCandidates(browser: Exclude<BrowserId, "unknown">, env: NodeJS.ProcessEnv = {}): string[] {
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LocalAppData].filter((v): v is string => !!v)
  const rels: Record<Exclude<BrowserId, "unknown">, string[]> = {
    chrome: ["Google\\Chrome\\Application\\chrome.exe"],
    edge: ["Microsoft\\Edge\\Application\\msedge.exe"],
    firefox: ["Mozilla Firefox\\firefox.exe"],
  }
  const out: string[] = []
  for (const root of roots) for (const rel of rels[browser]) out.push(join(root, rel))
  return out
}

/** 解析浏览器可执行文件路径;win32 找不到或非 win32 返回对应裸名/undefined */
export function resolveBrowserExe(
  platform: NodeJS.Platform,
  browser: BrowserId,
  env: NodeJS.ProcessEnv = {},
): string | undefined {
  if (browser === "unknown") return undefined
  if (platform === "win32") {
    for (const p of winBrowserExeCandidates(browser, env)) {
      if (existsSync(p)) return p
    }
    return undefined
  }
  return browser === "chrome" ? "google-chrome" : browser === "edge" ? "microsoft-edge" : "firefox"
}

/**
 * 构造隐身模式打开浏览器执行计划(纯函数,便于单测)。
 *
 * - browser 为 unknown → 回退 buildOpenPlan 普通模式
 * - win32 且未能解析出可执行文件 → 回退普通模式(避免裸名 spawn ENOENT 静默失败)
 * - mac 走 `open -na <App> --args <flag>`;linux/win 直接调可执行 + flag
 */
export function buildIncognitoPlan(
  platform: NodeJS.Platform,
  browser: BrowserId,
  url: string,
  opts: { exe?: string } = {},
): { file: string; args: string[] } {
  if (browser === "unknown") return buildOpenPlan(platform, url)
  const flag = browser === "firefox" ? "-private-window" : browser === "edge" ? "--inprivate" : "--incognito"
  if (platform === "darwin") {
    const app = browser === "chrome" ? "Google Chrome" : browser === "edge" ? "Microsoft Edge" : "Firefox"
    return { file: "open", args: ["-na", app, "--args", flag, url] }
  }
  if (platform === "win32" && !opts.exe) return buildOpenPlan(platform, url)
  const file = opts.exe ?? (browser === "chrome" ? "google-chrome" : browser === "edge" ? "microsoft-edge" : "firefox")
  return { file, args: [flag, url] }
}

/** 探测 + 构造隐身打开计划(供 openURL 使用);探测失败自动回退普通模式 */
export function buildIncognitoPlanFor(
  platform: NodeJS.Platform,
  url: string,
  env: NodeJS.ProcessEnv = {},
): { file: string; args: string[] } {
  const id = detectDefaultBrowser(platform, env)
  const exe = resolveBrowserExe(platform, id, env)
  return buildIncognitoPlan(platform, id, url, { exe })
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

// ===== 增量探测:auth status 分类 =====

/** 探测状态分类:missing=HOME 缺失 / expired=需重登 / valid=有效跳过 / unknown=不可解析(fail-safe 视为需重登) */
export type ProbeStatus = "missing" | "expired" | "valid" | "unknown"

/** 探测结果:状态 + 展示原因 */
export interface ProbeResult {
  status: ProbeStatus
  reason: string
}

/**
 * 按 D1 规则将 `arkcli auth status` 输出分类为登录态有效性。
 *
 * 纯函数:仅依据退出码/stdout/stderr 判定,不触碰文件系统。
 * fail-safe:任何无法明确判定为「有效」的情况均归为 expired/unknown(即需重登),
 * 宁可多登一次也不跳过陈旧会话。
 *
 * 过期特征(2026-10-03 实测,见 design D1):
 *  - 非零退出 + 错误文本含 refresh/sso/not logged/未登录
 *  - 退出 0 + `logged_in: false`(fresh HOME)
 *  - 退出 0 + `volc_sso.expired == true`
 *  - 退出 0 + `control_plane_auth.status == "needs_login"`
 *  - 退出 0 + `{ok:false}` 错误 JSON
 */
export function classifyAuthStatus(exitCode: number | null, stdout: string, stderr: string): ProbeStatus {
  const text = `${stdout}\n${stderr}`
  const expiredHint = /refresh|sso|not logged|未登录|expired/i.test(text)
  if (exitCode !== 0) return expiredHint ? "expired" : "unknown"
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>
    const sso = data.volc_sso as { expired?: boolean } | undefined
    const cpa = data.control_plane_auth as { status?: string } | undefined
    if (data.logged_in === false) return "expired"
    if (sso?.expired === true) return "expired"
    if (cpa?.status === "needs_login") return "expired"
    if (data.ok === false || data.error) return expiredHint ? "expired" : "unknown"
    return "valid"
  } catch {
    return expiredHint ? "expired" : "unknown"
  }
}

/** 探测状态的可读原因(用于 --dry-run 分类预览) */
export function describeProbe(status: ProbeStatus, detail: string): string {
  switch (status) {
    case "missing":
      return "HOME 目录缺失"
    case "expired":
      return "SSO 已过期/未登录(需重登)"
    case "valid":
      return "登录态有效(跳过)"
    case "unknown":
      return `探测不可解析,按需重登处理(${detail.slice(0, 60)})`
  }
}

/** 探测单账号:注入该账号 HOME 执行 `arkcli auth status` 并分类 */
export async function probeAccount(home: string): Promise<ProbeResult> {
  if (!existsSync(home)) return { status: "missing", reason: "HOME 目录缺失" }
  const res = await execArkcli(["auth", "status"], home)
  const status = classifyAuthStatus(res.exitCode, res.stdout, res.stderr)
  return { status, reason: describeProbe(status, firstLine(res.stderr || res.stdout)) }
}

/** 账号是否需要重登(增量模式据此筛选;unknown 按需重登 fail-safe) */
export function needsLogin(status: ProbeStatus): boolean {
  return status !== "valid"
}

// ===== 剪贴板捕获:base64 + state 校验 =====

/** 剪贴板读取命令计划(纯函数,便于单测):win PowerShell / mac pbpaste / linux xclip */
export function buildClipboardCommand(platform: NodeJS.Platform): { file: string; args: string[] } {
  if (platform === "darwin") return { file: "pbpaste", args: [] }
  if (platform === "linux") return { file: "xclip", args: ["-o", "-selection", "clipboard"] }
  return { file: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"] }
}

/** Linux Wayland 备选剪贴板读取命令 */
export function buildClipboardFallbackCommand(): { file: string; args: string[] } {
  return { file: "wl-paste", args: ["--no-newline"] }
}

/** 读取当前剪贴板文本(trim);不可用/为空返回空串 */
export async function readClipboard(): Promise<string> {
  const primary = buildClipboardCommand(process.platform)
  const res = await exec(primary.file, primary.args, { timeoutMs: 5000 })
  if (res.exitCode === 0 && res.stdout.trim().length > 0) return res.stdout.trim()
  if (process.platform === "linux") {
    const fb = buildClipboardFallbackCommand()
    const res2 = await exec(fb.file, fb.args, { timeoutMs: 5000 })
    if (res2.exitCode === 0) return res2.stdout.trim()
  }
  return ""
}

/** base64 解码(容错 URL-safe 字符与缺失 padding),失败返回 null */
export function base64Decode(s: string): string | null {
  try {
    const normalized = s.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    return Buffer.from(padded, "base64").toString("utf8")
  } catch {
    return null
  }
}

/**
 * 从剪贴板文本提取并校验授权码。
 *
 * 授权码 = base64("code=..&state=<Phase1 state>"):以 Phase 1 的 `state` 为校验锚点,
 * 防止误捕用户复制到剪贴板的其它内容。校验通过返回原始 base64 文本
 * (直接喂 Phase 2 `--code`),否则返回 undefined。
 */
export function extractAuthCode(text: string, state: string): string | undefined {
  const candidate = text.trim()
  if (!candidate) return undefined
  const decoded = base64Decode(candidate)
  if (!decoded) return undefined
  if (!decoded.includes("code=")) return undefined
  if (!state || !decoded.includes(`state=${state}`)) return undefined
  return candidate
}

/** 从 authorize_url 提取 state 参数(剪贴板校验锚点) */
export function extractStateFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("state") ?? undefined
  } catch {
    const m = url.match(/[?&]state=([^&]+)/)
    return m ? decodeURIComponent(m[1]) : undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 轮询剪贴板等待授权码,直到校验命中或超时。
 * 返回捕获的授权码;超时/不可用返回 undefined(调用方回退手工粘贴)。
 */
export async function waitForClipboardCode(
  state: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string | undefined> {
  const intervalMs = opts.intervalMs ?? 2000
  const timeoutMs = opts.timeoutMs ?? PHASE1_TTL_MS
  const deadline = Date.now() + timeoutMs
  let last = await readClipboard()
  const firstHit = extractAuthCode(last, state)
  if (firstHit) return firstHit
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const cur = await readClipboard()
    if (cur === last) continue
    last = cur
    const hit = extractAuthCode(cur, state)
    if (hit) return hit
  }
  return undefined
}

/** 登录行为选项(来自 CLI args,见 parseArgs) */
export interface LoginOptions {
  /** 授权码输入方式:默认 clipboard(剪贴板捕获 + 手工回退),manual 强制手工 */
  codeInput?: "clipboard" | "manual"
  /** 授权 URL 打开方式:默认 incognito(隐身),normal 普通模式 */
  browser?: "incognito" | "normal"
  /** 登录流:默认 cross-device;local-callback 由 spike 门控(未通过前回退 cross-device) */
  flow?: "cross-device" | "local-callback"
}

/**
 * local-callback 流:借 arkcli `auth login volc-sso`(auto 模式)本地端口回调完成登录,
 * 授权后浏览器自动跳回 127.0.0.1 回调,免复制/粘贴。
 *
 * 2026-10-03 spike 实测(1.0.37):auto 模式自带本地回调(redirect_uri=127.0.0.1:<随机端口>),
 * arkcli **自行打开普通模式浏览器**(无 flag/env 可抑制,故本流无法叠加隐身,D4「自开不可抑制」分支),
 * 并在回调前阻塞等待。本流以长超时等待回调完成;超时/失败由调用方回退 cross-device。
 */
export async function loginAccountLocalCallback(name: string, home: string): Promise<LoginResult> {
  try {
    rmSync(home, { recursive: true, force: true })

    console.log(`[${name}] 将打开浏览器完成火山 SSO 授权(本地回调自动完成,无需复制授权码;普通模式窗口)...`)
    const res = await execArkcli(["auth", "login", "volc-sso"], home, { timeoutMs: LOCAL_CALLBACK_TIMEOUT_MS })
    if (res.exitCode !== 0) {
      return { name, home, ok: false, error: `本地回调登录失败: ${firstLine(res.stderr || res.stdout)}` }
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

/**
 * 单个账号完整登录:删 HOME → 发起授权 → 打开浏览器 → 剪贴板/贴码完成 → profile 兜底 → 验证。
 *
 * flow 为 local-callback 时走 arkcli auto 模式本地回调(见 loginAccountLocalCallback)。
 */
export async function loginAccount(name: string, home: string, opts: LoginOptions = {}): Promise<LoginResult> {
  if ((opts.flow ?? "cross-device") === "local-callback") {
    const res = await loginAccountLocalCallback(name, home)
    if (res.ok) return res
    console.log(`[${name}] local-callback 失败,回退 cross-device 流: ${res.error}`)
  }
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
    openURL(url, opts.browser ?? "incognito")

    // 授权码获取:剪贴板自动捕获(带 state 校验)→ 失败回退手工粘贴
    const state = extractStateFromUrl(url) ?? ""
    let code: string | undefined
    if ((opts.codeInput ?? "clipboard") === "clipboard" && state) {
      console.log(`[${name}] 请在浏览器完成授权并复制页面显示的 base64 授权码(脚本将自动从剪贴板捕获)...`)
      code = await waitForClipboardCode(state)
      if (code) console.log(`[${name}] 已从剪贴板捕获授权码`)
    }
    if (!code) {
      code = await promptLine(`[${name}] 请在浏览器完成授权后,粘贴 base64 授权码: `)
    }
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
  /** 全量重登:跳过探测,清空全部账号 HOME 后逐账号重登 */
  force: boolean
  /** 仅处理指定账号 */
  only?: string
  /** 授权 URL 打开方式:默认隐身,`normal` 强制普通模式 */
  browser: "incognito" | "normal"
  /** 授权码输入方式:默认剪贴板捕获(+手工回退),`manual` 强制手工粘贴 */
  codeInput: "clipboard" | "manual"
  /** 登录流:默认跨设备流;local-callback 由 spike 门控 */
  flow: "cross-device" | "local-callback"
}

/** 解析命令行参数 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    config: DEFAULT_CONFIG,
    dryRun: false,
    force: false,
    browser: "incognito",
    codeInput: "clipboard",
    flow: "cross-device",
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--help" || a === "-h") {
      args.dryRun = true
    } else if (a === "--dry-run") {
      args.dryRun = true
    } else if (a === "--force") {
      args.force = true
    } else if (a === "--only") {
      args.only = argv[++i] ?? undefined
    } else if (a.startsWith("--only=")) {
      args.only = a.slice("--only=".length)
    } else if (a === "--browser") {
      args.browser = argv[++i] === "normal" ? "normal" : "incognito"
    } else if (a.startsWith("--browser=")) {
      args.browser = a.slice("--browser=".length) === "normal" ? "normal" : "incognito"
    } else if (a === "--code-input") {
      args.codeInput = argv[++i] === "manual" ? "manual" : "clipboard"
    } else if (a.startsWith("--code-input=")) {
      args.codeInput = a.slice("--code-input=".length) === "manual" ? "manual" : "clipboard"
    } else if (a === "--flow") {
      args.flow = argv[++i] === "local-callback" ? "local-callback" : "cross-device"
    } else if (a.startsWith("--flow=")) {
      args.flow = a.slice("--flow=".length) === "local-callback" ? "local-callback" : "cross-device"
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
  bun scripts/login-arkcli-accounts.ts                     默认增量,读 opencode.jsonc
  bun scripts/login-arkcli-accounts.ts --config <path>     指定配置文件
  bun scripts/login-arkcli-accounts.ts --dry-run           只打印分类计划,不登录
  bun scripts/login-arkcli-accounts.ts --force             全量清空后重登全部账号
  bun scripts/login-arkcli-accounts.ts --only <name>       只处理指定账号
  bun scripts/login-arkcli-accounts.ts --browser normal    普通模式打开(默认隐身)
  bun scripts/login-arkcli-accounts.ts --code-input manual 强制手工粘贴(默认剪贴板捕获)
  bun scripts/login-arkcli-accounts.ts --help              显示本帮助
`)
}

/** 逐账号登录并渲染结果 */
async function runLogins(accounts: AccountEntry[], opts: LoginOptions = {}): Promise<number> {
  const results: LoginResult[] = []
  for (const a of accounts) {
    console.log(`\n=== ${a.name} ===`)
    results.push(await loginAccount(a.name, a.home, opts))
  }
  console.log("\n" + renderProgress(results))
  return results.every((r) => r.ok) ? 0 : 1
}

/** 从 CLI args 提取登录行为选项 */
function loginOptsFromArgs(args: CliArgs): LoginOptions {
  return { codeInput: args.codeInput, browser: args.browser, flow: args.flow }
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

  // --only:仅处理指定账号
  if (args.only) {
    const match = accounts.find((a) => a.name === args.only)
    if (!match) {
      console.error(`未找到账号 "${args.only}"。可用账号:`)
      for (const a of accounts) console.error(`  ${a.name}`)
      return 1
    }
    accounts = [match]
  }

  const homeRoot = dirname(accounts[0].home)

  // --force:旧全量清空重登(跳过探测)
  if (args.force) {
    if (args.dryRun) {
      console.log(`[dry-run] 将清空账号根目录 ${homeRoot} 并全量重登 (config: ${args.config}):`)
      for (const a of accounts) console.log(`  ${a.name} -> ${a.home}`)
      return 0
    }
    const err = resetAccountRoot(homeRoot)
    if (err) {
      console.error(`清空账号根目录失败: ${err}`)
      return 1
    }
    console.log(`已清空账号根目录: ${homeRoot}`)
    console.log(`开始全量重登 ${accounts.length} 个账号 (config: ${args.config}):`)
    return runLogins(accounts, loginOptsFromArgs(args))
  }

  // 增量:先逐账号探测,仅重登过期/未登录/缺失的账号,有效账号跳过
  console.log(`探测 ${accounts.length} 个账号登录态 (config: ${args.config}):`)
  const plan: Array<{ name: string; home: string; probe: ProbeResult }> = []
  for (const a of accounts) {
    const probe = await probeAccount(a.home)
    plan.push({ name: a.name, home: a.home, probe })
    const mark = probe.status === "valid" ? "✓ 跳过" : "✗ 重登"
    console.log(`  ${mark} ${a.name} — ${probe.reason}`)
  }

  if (args.dryRun) {
    console.log(`\n[dry-run] 分类计划(未执行任何清空/登录):`)
    for (const p of plan) {
      console.log(`  ${p.probe.status === "valid" ? "跳过" : "重登"}  ${p.name}`)
    }
    const need = plan.filter((p) => needsLogin(p.probe.status))
    console.log(`\n需重登 ${need.length}/${plan.length} 个账号`)
    return 0
  }

  const toLogin = plan.filter((p) => needsLogin(p.probe.status))
  if (toLogin.length === 0) {
    console.log("\n所有账号登录态有效,无需重登。")
    return 0
  }

  console.log(`\n开始重登 ${toLogin.length} 个账号:`)
  return runLogins(toLogin.map((p) => ({ name: p.name, home: p.home })), loginOptsFromArgs(args))
}

// bun 直跑时进入主流程(被 import 测试时不执行)
if (import.meta.main) {
  process.exit(await main())
}
