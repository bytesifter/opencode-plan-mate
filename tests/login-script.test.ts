import { test, expect } from "bun:test"
import {
  buildSpawn,
  buildOpenPlan,
  buildOpenPlanEnv,
  expandHome,
  extractAccounts,
  hasNestedPollution,
  loginPhase1Args,
  loginPhase2Args,
  parseAuthorizeUrl,
  parseArgs,
  renderProgress,
  resetAccountRoot,
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
test("parseArgs 解析 --config / --dry-run / --help", () => {
  expect(parseArgs(["--config", "custom.jsonc", "--dry-run"])).toEqual({
    config: "custom.jsonc",
    dryRun: true,
  })
  expect(parseArgs(["--config=abc.jsonc"])).toEqual({ config: "abc.jsonc", dryRun: false })
  expect(parseArgs(["--help"])).toEqual({ config: "opencode.jsonc", dryRun: true })
  expect(parseArgs([])).toEqual({ config: "opencode.jsonc", dryRun: false })
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
