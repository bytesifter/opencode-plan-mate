import { test, expect } from "bun:test"
import {
  base64Decode,
  browserIdFromProgId,
  buildClipboardCommand,
  buildClipboardFallbackCommand,
  buildIncognitoPlan,
  buildOpenPlan,
  buildOpenPlanEnv,
  buildSpawn,
  classifyAuthStatus,
  describeProbe,
  expandHome,
  extractAccounts,
  extractAuthCode,
  extractStateFromUrl,
  hasNestedPollution,
  loginPhase1Args,
  loginPhase2Args,
  needsLogin,
  parseAuthorizeUrl,
  parseArgs,
  renderProgress,
  resetAccountRoot,
  resolveBrowserExe,
  trustedHomeDir,
  type LoginResult,
} from "../scripts/login-arkcli-accounts"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// ===== buildSpawn:跨平台执行计划 =====
test("buildSpawn win32 走 cmd.exe /c 解析 .cmd 垫片", () => {
  const plan = buildSpawn("win32", "arkcli", ["auth", "login"])
  expect(plan.file.toLowerCase()).toContain("cmd.exe")
  expect(plan.args).toEqual(["/c", "arkcli", "auth", "login"])
})

test("buildSpawn POSIX 原样直接执行", () => {
  expect(buildSpawn("linux", "arkcli", ["--version"])).toEqual({ file: "arkcli", args: ["--version"] })
  expect(buildSpawn("darwin", "arkcli", ["--version"])).toEqual({ file: "arkcli", args: ["--version"] })
})

// ===== expandHome =====
test("expandHome 展开 ~ 与 ~/ 前缀", () => {
  const home = expandHome("~")
  expect(expandHome("~/a/b")).toMatch(new RegExp(`[\\/\\\\]a[\\/\\\\]b$`))
  expect(expandHome("~\\a\\b")).toMatch(new RegExp(`[\\/\\\\]a[\\/\\\\]b$`))
  expect(expandHome("plain/path")).toBe("plain/path")
})

// ===== trustedHomeDir:HOME 污染回退 =====
test("trustedHomeDir 干净 USERPROFILE 原样返回", () => {
  expect(trustedHomeDir({ USERPROFILE: "C:\\Users\\nixgn" })).toBe("C:\\Users\\nixgn")
})

test("trustedHomeDir 污染 USERPROFILE 回退 HOMEDRIVE+HOMEPATH", () => {
  const env = {
    USERPROFILE: "C:\\Users\\nixgn\\.arkcli-accounts\\volhwy2410\\.arkcli-accounts\\account-a",
    HOMEDRIVE: "C:",
    HOMEPATH: "\\Users\\nixgn",
  }
  expect(trustedHomeDir(env)).toBe("C:\\Users\\nixgn")
})

test("trustedHomeDir 污染且无 HOMEDRIVE 时兜底 C:\\Users\\<USERNAME>", () => {
  const env = {
    USERPROFILE: "C:\\Users\\nixgn\\.arkcli-accounts\\volhwy2410",
    USERNAME: "nixgn",
  }
  expect(trustedHomeDir(env)).toBe("C:\\Users\\nixgn")
})

// ===== hasNestedPollution:嵌套 HOME 检测 =====
test("hasNestedPollution 合法单账号 HOME 不误报", () => {
  expect(hasNestedPollution("C:\\Users\\nixgn\\.arkcli-accounts\\volxc9208")).toBe(false)
  expect(hasNestedPollution("/home/nixgn/.arkcli-accounts/volxc9208")).toBe(false)
})

test("hasNestedPollution 嵌套 HOME 命中", () => {
  expect(
    hasNestedPollution(
      "C:\\Users\\nixgn\\.arkcli-accounts\\volhwy2410\\.arkcli-accounts\\account-a\\.arkcli-accounts\\volxc9208",
    ),
  ).toBe(true)
})

// ===== extractAccounts:JSONC 解析 =====
test("extractAccounts 解析含注释与尾逗号的 opencode.jsonc", () => {
  const text = `{
    "plugin": [
      "other-plugin",
      ["file:///path/to/plugin", {
        "providers": ["a", "b"],
        "planStats": { "accounts": { "acct-a": "~/.arkcli-accounts/a", "acct-b": "~/.arkcli-accounts/b" } }
      }],
      ["file:///path/other", { "no": "planStats" }]
    ]
  }`
  const accounts = extractAccounts(text)
  expect(accounts.map((a) => a.name)).toEqual(["acct-a", "acct-b"])
  expect(accounts[0].home).toMatch(/[\\/]\.arkcli-accounts[\\/]a$/)
  expect(accounts[1].home).toMatch(/[\\/]\.arkcli-accounts[\\/]b$/)
})

test("extractAccounts 无 planStats.accounts 返回空数组", () => {
  expect(extractAccounts('{"plugin": [["p", {"x": 1}]]}')).toEqual([])
  expect(extractAccounts("not-json{")).toEqual([])
})

// ===== extractAccounts:v2 plugins 数组形态 =====
test("extractAccounts 解析 v2 plugins 对象形态", () => {
  const text = `{
    "plugins": [
      "opencode-acme-plugin",
      {
        "package": "file:///D:/code/opencode-plan-mate",
        "options": {
          "providers": ["a", "b"],
          "planStats": { "accounts": { "acct-a": "~/.arkcli-accounts/a", "acct-b": "~/.arkcli-accounts/b" } }
        }
      },
      { "package": "other", "options": { "no": "planStats" } }
    ]
  }`
  const accounts = extractAccounts(text)
  expect(accounts.map((a) => a.name)).toEqual(["acct-a", "acct-b"])
  expect(accounts[0].home).toMatch(/[\\/]\.arkcli-accounts[\\/]a$/)
  expect(accounts[1].home).toMatch(/[\\/]\.arkcli-accounts[\\/]b$/)
})

test("extractAccounts v2 与 v1 双形态并存时都解析", () => {
  const text = `{
    "plugin": [
      ["file:///path/v1", { "planStats": { "accounts": { "legacy-a": "~/.arkcli-accounts/la" } } }]
    ],
    "plugins": [
      { "package": "file:///path/v2", "options": { "planStats": { "accounts": { "new-a": "~/.arkcli-accounts/na" } } } }
    ]
  }`
  const accounts = extractAccounts(text)
  expect(accounts.map((a) => a.name).sort()).toEqual(["legacy-a", "new-a"])
})

test("extractAccounts v2 无 planStats 或空数组返回空", () => {
  expect(extractAccounts('{"plugins": ["pkg", {"package": "x", "options": {"y": 1}}]}')).toEqual([])
  expect(extractAccounts('{"plugins": []}')).toEqual([])
})

// ===== loginPhase1Args / loginPhase2Args:auth login 显式走 legacy 链路 =====
test("loginPhase1Args 携带 --no-browser 与 --login-mode legacy", () => {
  const args = loginPhase1Args()
  expect(args).toContain("auth")
  expect(args).toContain("login")
  expect(args).toContain("--no-browser")
  expect(args).toContain("--login-mode")
  expect(args).toContain("legacy")
})

test("loginPhase2Args 携带 --login-mode legacy 与 --code", () => {
  const args = loginPhase2Args("base64-code")
  expect(args).toContain("--no-browser")
  expect(args).toContain("--login-mode")
  expect(args).toContain("legacy")
  expect(args).toContain("--code")
  expect(args).toContain("base64-code")
})

// ===== parseAuthorizeUrl =====
test("parseAuthorizeUrl 从 stdout JSON 提取 authorize_url", () => {
  const out = JSON.stringify({
    authorize_url: "https://signin.example/authorize?x=1",
    stage: "authorize_pending",
    method: "sso_no_browser",
  })
  expect(parseAuthorizeUrl(out)).toBe("https://signin.example/authorize?x=1")
  expect(parseAuthorizeUrl("not json")).toBeUndefined()
  expect(parseAuthorizeUrl('{"other": 1}')).toBeUndefined()
})

// ===== parseArgs =====
test("parseArgs 解析 --config / --dry-run / --help 及默认值", () => {
  const defaults = {
    config: "opencode.jsonc",
    dryRun: false,
    force: false,
    only: undefined,
    browser: "incognito",
    codeInput: "clipboard",
    flow: "cross-device",
  } as const
  expect(parseArgs(["--config", "custom.jsonc", "--dry-run"])).toEqual({ ...defaults, config: "custom.jsonc", dryRun: true })
  expect(parseArgs(["--config=abc.jsonc"])).toEqual({ ...defaults, config: "abc.jsonc" })
  expect(parseArgs(["--help"])).toEqual({ ...defaults, dryRun: true })
  expect(parseArgs([])).toEqual(defaults)
})

test("parseArgs 解析 --force / --only / --browser / --code-input / --flow", () => {
  const defaults = {
    config: "opencode.jsonc",
    dryRun: false,
    force: false,
    only: undefined,
    browser: "incognito",
    codeInput: "clipboard",
    flow: "cross-device",
  } as const
  expect(parseArgs(["--force"])).toEqual({ ...defaults, force: true })
  expect(parseArgs(["--only", "vollc5427"])).toEqual({ ...defaults, only: "vollc5427" })
  expect(parseArgs(["--only=vollc5427"])).toEqual({ ...defaults, only: "vollc5427" })
  expect(parseArgs(["--browser", "normal"])).toEqual({ ...defaults, browser: "normal" })
  expect(parseArgs(["--browser=normal"])).toEqual({ ...defaults, browser: "normal" })
  expect(parseArgs(["--browser", "incognito"])).toEqual({ ...defaults, browser: "incognito" })
  expect(parseArgs(["--code-input", "manual"])).toEqual({ ...defaults, codeInput: "manual" })
  expect(parseArgs(["--code-input=manual"])).toEqual({ ...defaults, codeInput: "manual" })
  expect(parseArgs(["--flow", "local-callback"])).toEqual({ ...defaults, flow: "local-callback" })
  expect(parseArgs(["--flow=cross-device"])).toEqual({ ...defaults, flow: "cross-device" })
})

// ===== classifyAuthStatus:auth status 输出分类(D1) =====
test("classifyAuthStatus 非零退出 + refresh 报错 → expired", () => {
  const stderr = "ark: GetCodingPlanUsage requires Volcengine Ark SSO STS ... refresh_token is invalid."
  expect(classifyAuthStatus(1, "", stderr)).toBe("expired")
})

test("classifyAuthStatus 非零退出无过期特征 → unknown(fail-safe)", () => {
  expect(classifyAuthStatus(2, "", "boom: something else")).toBe("unknown")
})

test("classifyAuthStatus 退出 0 + logged_in:false → expired(fresh HOME)", () => {
  const out = JSON.stringify({ auth_method: "none", logged_in: false })
  expect(classifyAuthStatus(0, out, "")).toBe("expired")
})

test("classifyAuthStatus 退出 0 + volc_sso.expired → expired", () => {
  const out = JSON.stringify({ logged_in: true, volc_sso: { expired: true } })
  expect(classifyAuthStatus(0, out, "")).toBe("expired")
})

test("classifyAuthStatus 退出 0 + control_plane_auth.needs_login → expired", () => {
  const out = JSON.stringify({
    logged_in: true,
    control_plane_auth: { status: "needs_login", reason: "refresh_failed" },
    volc_sso: { expired: true },
  })
  expect(classifyAuthStatus(0, out, "")).toBe("expired")
})

test("classifyAuthStatus 退出 0 + 无过期标记 → valid", () => {
  const out = JSON.stringify({ logged_in: true, auth_method: "sso", volc_sso: { expired: false } })
  expect(classifyAuthStatus(0, out, "")).toBe("valid")
})

test("classifyAuthStatus 退出 0 + 非 JSON → unknown(fail-safe)", () => {
  expect(classifyAuthStatus(0, "not json at all", "")).toBe("unknown")
})

test("classifyAuthStatus 退出 0 + {ok:false} 错误 JSON → expired", () => {
  const out = JSON.stringify({ ok: false, error: { message: "... refresh_token is invalid" } })
  expect(classifyAuthStatus(0, out, "")).toBe("expired")
})

test("needsLogin 仅 valid 为 false", () => {
  expect(needsLogin("valid")).toBe(false)
  expect(needsLogin("missing")).toBe(true)
  expect(needsLogin("expired")).toBe(true)
  expect(needsLogin("unknown")).toBe(true)
})

test("describeProbe 给出可读原因", () => {
  expect(describeProbe("missing", "")).toContain("缺失")
  expect(describeProbe("expired", "")).toContain("过期")
  expect(describeProbe("valid", "")).toContain("跳过")
  expect(describeProbe("unknown", "xyz")).toContain("重登")
})

// ===== buildOpenPlan:Windows URL 不被 cmd 解析截断 =====
test("buildOpenPlan win32 用 rundll32 且 URL 作为单个完整 argv", () => {
  const url =
    "https://signin.volcengine.com/authorize/oauth/authorize?client_id=trn%3Asignin&code_challenge=7tX2ORygUzUU&redirect_uri=https%3A%2F%2Fsignin.volcengine.com%2Fauthorize%2Foauth%2Fauthorize&response_type=code"
  const plan = buildOpenPlan("win32", url)
  expect(plan.file.toLowerCase()).toContain("rundll32.exe")
  expect(plan.args).toEqual(["url.dll,FileProtocolHandler", url])
  // 关键:URL 含多个 `&` 与 `%XX`,必须作为单个 argv 传递,不被 cmd 拆散
  expect(plan.args[1]).toBe(url)
  expect(plan.args[1].includes("&redirect_uri=")).toBe(true)
  expect(plan.args[1].includes("%3A%2F%2F")).toBe(true)
})

test("buildOpenPlan darwin/linux 直传 URL", () => {
  expect(buildOpenPlan("darwin", "https://x.com/a?b=1")).toEqual({ file: "open", args: ["https://x.com/a?b=1"] })
  expect(buildOpenPlan("linux", "https://x.com/a?b=1")).toEqual({ file: "xdg-open", args: ["https://x.com/a?b=1"] })
})

// ===== renderProgress =====
test("renderProgress 汇总成功/失败并显示比例", () => {
  const results: LoginResult[] = [
    { name: "a", home: "/h/a", ok: true },
    { name: "b", home: "/h/b", ok: false, error: "授权码无效" },
  ]
  const out = renderProgress(results)
  expect(out).toContain("✓ a")
  expect(out).toContain("✗ b")
  expect(out).toContain("授权码无效")
  expect(out).toContain("成功 1/2")
})

// ===== resetAccountRoot:全量清空账号根目录 =====
function makeHomeRoot(): string {
  const root = join(tmpdir(), `login-reset-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  return root
}

test("resetAccountRoot 清空整个根目录(含多账号与嵌套残留)", () => {
  const root = makeHomeRoot()
  try {
    mkdirSync(join(root, "volhwy2410", ".arkcli-accounts", "account-a"), { recursive: true })
    writeFileSync(join(root, "volhwy2410", ".arkcli-accounts", "account-a", "x.txt"), "x")
    mkdirSync(join(root, "volxc9208", ".arkcli"), { recursive: true })
    writeFileSync(join(root, "volxc9208", ".arkcli", "config.yaml"), "keep")
    const err = resetAccountRoot(root)
    expect(err).toBeUndefined()
    expect(existsSync(root)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("resetAccountRoot 目录不存在时不报错", () => {
  const root = makeHomeRoot()
  rmSync(root, { recursive: true, force: true })
  const err = resetAccountRoot(root)
  expect(err).toBeUndefined()
})

// ===== buildOpenPlanEnv:浏览器子进程注入可信真实 home =====
test("buildOpenPlanEnv 干净 env 注入 HOME 与 USERPROFILE 为该 home(win32)", () => {
  const base = { USERPROFILE: "C:\\Users\\nixgn", PATH: "/x" }
  const plan = buildOpenPlanEnv("win32", "https://signin.volcengine.com/a?b=1", base)
  expect(plan.file.toLowerCase()).toContain("rundll32.exe")
  expect(plan.env.HOME).toBe("C:\\Users\\nixgn")
  expect(plan.env.USERPROFILE).toBe("C:\\Users\\nixgn")
  // 保留其它环境
  expect(plan.env.PATH).toBe("/x")
})

test("buildOpenPlanEnv 污染 env 注入回退后的真实 home(而非账号 home/污染路径)", () => {
  const base = {
    USERPROFILE: "C:\\Users\\nixgn\\.arkcli-accounts\\volhwy2410\\.arkcli-accounts\\account-a",
    HOMEDRIVE: "C:",
    HOMEPATH: "\\Users\\nixgn",
  }
  const plan = buildOpenPlanEnv("win32", "https://signin.volcengine.com/a?b=1", base)
  expect(plan.env.HOME).toBe("C:\\Users\\nixgn")
  expect(plan.env.USERPROFILE).toBe("C:\\Users\\nixgn")
  expect(plan.env.USERPROFILE!.includes(".arkcli-accounts")).toBe(false)
})

test("buildOpenPlanEnv 注入可信 home(darwin/linux)", () => {
  const d = buildOpenPlanEnv("darwin", "https://x.com/a", { USERPROFILE: "/home/u" })
  expect(d.file).toBe("open")
  expect(d.env.HOME).toBe("/home/u")
  expect(d.env.USERPROFILE).toBe("/home/u")
  const l = buildOpenPlanEnv("linux", "https://x.com/a", { USERPROFILE: "/home/u" })
  expect(l.file).toBe("xdg-open")
  expect(l.env.HOME).toBe("/home/u")
  expect(l.env.USERPROFILE).toBe("/home/u")
})

// ===== 剪贴板捕获:base64 + state 校验 =====
test("buildClipboardCommand 按平台返回剪贴板读取命令", () => {
  expect(buildClipboardCommand("win32").file.toLowerCase()).toContain("powershell")
  expect(buildClipboardCommand("darwin")).toEqual({ file: "pbpaste", args: [] })
  expect(buildClipboardCommand("linux")).toEqual({ file: "xclip", args: ["-o", "-selection", "clipboard"] })
  expect(buildClipboardFallbackCommand().file).toBe("wl-paste")
})

test("base64Decode 标准/URL-safe/缺失 padding 容错", () => {
  const raw = "code=abc&state=s1"
  const std = Buffer.from(raw, "utf8").toString("base64")
  expect(base64Decode(std)).toBe(raw)
  const urlSafe = std.replace(/\+/g, "-").replace(/\//g, "_")
  expect(base64Decode(urlSafe)).toBe(raw)
  const noPad = std.replace(/=+$/, "")
  expect(base64Decode(noPad)).toBe(raw)
})

test("extractAuthCode 命中:base64 解码 + state 匹配返回原码", () => {
  const state = "07af3e7b423ff4b9f0f64bc6fba3552b"
  const code = Buffer.from(`code=6eb05bd1cc05a5cb44a264f7be6cfcca&state=${state}`, "utf8").toString("base64")
  expect(extractAuthCode(code, state)).toBe(code)
})

test("extractAuthCode state 不匹配 → undefined(防误捕)", () => {
  const code = Buffer.from("code=abc&state=other", "utf8").toString("base64")
  expect(extractAuthCode(code, "my-state")).toBeUndefined()
})

test("extractAuthCode 非授权码内容/空 → undefined", () => {
  expect(extractAuthCode("随便复制的内容", "s")).toBeUndefined()
  expect(extractAuthCode("", "s")).toBeUndefined()
  const junk = Buffer.from("hello world no code here", "utf8").toString("base64")
  expect(extractAuthCode(junk, "s")).toBeUndefined()
})

test("extractStateFromUrl 提取 state", () => {
  const url = "https://signin.volcengine.com/authorize?client_id=x&state=07af3e7b423ff4b9f0f64bc6fba3552b"
  expect(extractStateFromUrl(url)).toBe("07af3e7b423ff4b9f0f64bc6fba3552b")
  expect(extractStateFromUrl("https://x.com/no-state")).toBeUndefined()
})

// ===== 隐身浏览器:探测 + flag + 回退 =====
test("browserIdFromProgId 映射", () => {
  expect(browserIdFromProgId("ChromeHTML")).toBe("chrome")
  expect(browserIdFromProgId("MSEdgeHTM")).toBe("edge")
  expect(browserIdFromProgId("FirefoxURL-308046B0AF4A39CB")).toBe("firefox")
  expect(browserIdFromProgId("OperaStable")).toBe("unknown")
})

test("buildIncognitoPlan linux 各浏览器 flag", () => {
  const url = "https://signin.volcengine.com/a?b=1"
  expect(buildIncognitoPlan("linux", "chrome", url)).toEqual({ file: "google-chrome", args: ["--incognito", url] })
  expect(buildIncognitoPlan("linux", "edge", url)).toEqual({ file: "microsoft-edge", args: ["--inprivate", url] })
  expect(buildIncognitoPlan("linux", "firefox", url)).toEqual({ file: "firefox", args: ["-private-window", url] })
})

test("buildIncognitoPlan mac 走 open -na + flag", () => {
  const url = "https://x.com/a"
  expect(buildIncognitoPlan("darwin", "chrome", url)).toEqual({
    file: "open",
    args: ["-na", "Google Chrome", "--args", "--incognito", url],
  })
  expect(buildIncognitoPlan("darwin", "edge", url)).toEqual({
    file: "open",
    args: ["-na", "Microsoft Edge", "--args", "--inprivate", url],
  })
  expect(buildIncognitoPlan("darwin", "firefox", url)).toEqual({
    file: "open",
    args: ["-na", "Firefox", "--args", "-private-window", url],
  })
})

test("buildIncognitoPlan unknown 浏览器回退普通模式", () => {
  const url = "https://x.com/a"
  expect(buildIncognitoPlan("linux", "unknown", url)).toEqual({ file: "xdg-open", args: [url] })
  expect(buildIncognitoPlan("win32", "unknown", url)).toEqual({
    file: "rundll32.exe",
    args: ["url.dll,FileProtocolHandler", url],
  })
})

test("buildIncognitoPlan win32 无 exe 回退普通;有 exe 用全路径 + flag", () => {
  const url = "https://x.com/a"
  expect(buildIncognitoPlan("win32", "chrome", url)).toEqual({ file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] })
  const exe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  expect(buildIncognitoPlan("win32", "chrome", url, { exe })).toEqual({ file: exe, args: ["--incognito", url] })
})

test("resolveBrowserExe 非 win32 裸命令名;win32 找不到/unknown → undefined", () => {
  expect(resolveBrowserExe("linux", "chrome", {})).toBe("google-chrome")
  expect(resolveBrowserExe("darwin", "firefox", {})).toBe("firefox")
  expect(resolveBrowserExe("win32", "chrome", {})).toBeUndefined()
  expect(resolveBrowserExe("win32", "unknown", {})).toBeUndefined()
})

test("resolveBrowserExe win32 命中候选路径(ProgramFiles)", () => {
  const root = makeHomeRoot()
  const chromePath = join(root, "Program Files", "Google", "Chrome", "Application", "chrome.exe")
  mkdirSync(join(root, "Program Files", "Google", "Chrome", "Application"), { recursive: true })
  writeFileSync(chromePath, "")
  try {
    expect(resolveBrowserExe("win32", "chrome", { ProgramFiles: join(root, "Program Files") })).toBe(chromePath)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
