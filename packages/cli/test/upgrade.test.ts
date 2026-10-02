import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { APP_DIRNAME } from "@opencode/util/fork/brand" // fork_change - per-user dirs are rooted on the fork name

describe("upgrade command", () => {
  test("is registered in root help and documents its options", async () => {
    const root = await cli(["--help"], {}, "../src/index.ts")
    const help = await cli(["upgrade", "--help"], {}, "../src/index.ts")
    expect(root.exitCode).toBe(0)
    expect(root.stdout).toContain("upgrade")
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain("[<target>]")
    expect(help.stdout).toContain("--method")
    expect(help.stdout).toContain("-m")
  })

  test("detects the installation method and resolves the latest version", async () => {
    const result = await cli([])
    expect(result.exitCode).toBe(0)
    expect(result.events).toEqual(["method", "latest", { method: "npm", version: "0.0.0-beta-new" }])
    expect(result.stdout).toContain("Upgrade complete")
  })

  test("accepts an explicit version and method without detection or a version lookup", async () => {
    const result = await cli(["v0.0.0-beta-target", "--method", "pnpm"])
    expect(result.exitCode).toBe(0)
    expect(result.events).toEqual([{ method: "pnpm", version: "v0.0.0-beta-target" }])
    expect(result.stdout).toContain("0.0.0-beta-old → 0.0.0-beta-target")
  })

  test("accepts the short method flag and an explicit major upgrade", async () => {
    const result = await cli(["2.0.0", "-m", "bun"])
    expect(result.exitCode).toBe(0)
    expect(result.events).toEqual([{ method: "bun", version: "2.0.0" }])
  })

  test("accepts vp as an explicit installation method", async () => {
    const result = await cli(["2.0.0", "--method", "vp"])
    expect(result.exitCode).toBe(0)
    expect(result.events).toEqual([{ method: "vp", version: "2.0.0" }])
  })

  test("skips the already installed version", async () => {
    const result = await cli(["v0.0.0-beta-old"])
    expect(result.exitCode).toBe(0)
    expect(result.events).toEqual(["method"])
    expect(result.stdout).toContain("already installed")
  })

  test("requires an explicit method when detection fails", async () => {
    const result = await cli([], { UPGRADE_TEST_METHOD: "unknown" })
    expect(result.exitCode).toBe(1)
    expect(result.events).toEqual(["method"])
    expect(result.stdout).toContain("Pass --method")
  })

  test("rejects unsupported methods before attempting an upgrade", async () => {
    const result = await cli(["--method", "apt"])
    expect(result.exitCode).not.toBe(0)
    expect(result.events).toEqual([])
  })

  test("reports version lookup failures without installing", async () => {
    const result = await cli([], { UPGRADE_TEST_LATEST_ERROR: "1" })
    expect(result.exitCode).toBe(1)
    expect(result.events).toEqual(["method", "latest"])
    expect(result.stdout).toContain("Update check failed")
  })

  test("reports installation failures with a nonzero exit code", async () => {
    const result = await cli([], { UPGRADE_TEST_INSTALL_ERROR: "1" })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("Upgrade failed")
    expect(result.stdout).toContain("Permission denied")
    expect(result.stdout).not.toContain("Upgrade complete")
  })
})


// fork_change start - this build does not self-update (src/fork/policy.ts). The
// tests above opt into the build-time define so they still cover upstream's
// per-package-manager install logic unmodified; these run without it, which is
// what a shipped binary gets.
describe("upgrade command as shipped", () => {
  const shipped = (args: string[] = [], env: Record<string, string> = {}) =>
    cli(args, env, "fixture/upgrade.ts", "disabled")

  test("refuses to self-update and names the supported path", async () => {
    const result = await shipped()
    expect(result.exitCode).not.toBe(0)
    // Refused before the updater is consulted, so nothing can reach upstream.
    expect(result.events).toEqual([])
    expect(result.stdout + result.stderr).toContain("does not self-update")
    expect(result.stdout + result.stderr).toContain("npm install -g genixcode@")
  })

  test("refuses even with an explicit version and method", async () => {
    const result = await shipped(["2.0.0", "--method", "npm"])
    expect(result.exitCode).not.toBe(0)
    expect(result.events).toEqual([])
  })

  test("never names upstream's installer host", async () => {
    const result = await shipped([], { UPGRADE_TEST_METHOD: "curl" })
    expect(result.stdout + result.stderr).not.toContain("opencode.ai")
  })

  test("no environment variable re-enables it", async () => {
    const result = await shipped([], {
      KILO_FORK_ENABLE_UPDATER: "1",
      GENIX_UPDATER_ENABLED: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "0",
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.events).toEqual([])
    expect(result.stdout + result.stderr).toContain("does not self-update")
  })
})
// fork_change end

// fork_change start - `updater` picks whether this run gets the build-time
// define that enables the updater. The subprocess is a fresh `bun`, so it does
// not inherit the one test/fork-run.ts passes to `bun test`; upstream's tests
// below opt in, and the fork's refusal tests deliberately do not, which is what
// a real build sees. There is no environment variable to set either way.
async function cli(
  args: string[],
  env: Record<string, string> = {},
  entry = "fixture/upgrade.ts",
  updater: "enabled" | "disabled" = "enabled",
) {
  const defines =
    updater === "enabled" ? ["--define", "GENIX_UPDATER_ENABLED=true"] : ["--define", "GENIX_UPDATER_ENABLED=false"]
  // fork_change end
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-upgrade-"))
  try {
    const child = Bun.spawn(
      // fork_change start - `defines` carries the updater switch; see above
      [
        process.execPath,
        "--define",
        'OPENCODE_VERSION="0.0.0-beta-old"',
        ...defines,
        path.join(import.meta.dir, entry),
        ...args,
      ],
      // fork_change end
      {
        cwd: path.join(import.meta.dir, ".."),
        env: {
          ...process.env,
          OPENCODE_TEST_HOME: root,
          XDG_DATA_HOME: path.join(root, "data"),
          XDG_CONFIG_HOME: path.join(root, "config"),
          XDG_CACHE_HOME: path.join(root, "cache"),
          XDG_STATE_HOME: path.join(root, "state"),
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const events = stdout
      .split("\n")
      .filter((line) => line.startsWith("EVENT "))
      .map((line) => JSON.parse(line.slice(6)))
    expect(await Bun.file(path.join(root, "state", APP_DIRNAME, "service-local.json") /* fork_change */).exists()).toBe(false)
    return { stdout, stderr, exitCode, events }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
