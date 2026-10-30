import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { APP_DIRNAME, CLI_NAME } from "@opencode/util/fork/brand" // fork_change - per-user dirs and binary are renamed

describe("debug paths command", () => {
  test("is included in troubleshooting help", async () => {
    const [debug, paths] = await Promise.all([cli(["debug", "--help"]), cli(["debug", "paths", "--help"])])

    expect(debug.exitCode).toBe(0)
    expect(debug.stdout).toContain("paths")
    expect(debug.stdout).toContain("Show global paths (data, config, cache, state)")
    expect(paths.exitCode).toBe(0)
    expect(paths.stdout).toContain(`${CLI_NAME} debug paths [flags]`) // fork_change
  })

  test("prints resolved global paths without starting a server", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-debug-paths-"))

    try {
      const result = await cli(["debug", "paths"], {
        XDG_DATA_HOME: path.join(root, "data"),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_STATE_HOME: path.join(root, "state"),
      })
      const paths = Object.fromEntries(
        result.stdout
          .trim()
          .split("\n")
          .map((line) => line.trim().split(/\s+/, 2)),
      )

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
      expect(paths).toMatchObject({
        home: os.homedir(),
        data: path.join(root, "data", APP_DIRNAME) /* fork_change */,
        config: path.join(root, "config", APP_DIRNAME) /* fork_change */,
        cache: path.join(root, "cache", APP_DIRNAME) /* fork_change */,
        state: path.join(root, "state", APP_DIRNAME) /* fork_change */,
        bin: path.join(root, "cache", APP_DIRNAME, "bin") /* fork_change */,
        log: path.join(root, "data", APP_DIRNAME, "log") /* fork_change */,
        repos: path.join(root, "data", APP_DIRNAME, "repos") /* fork_change */,
      })
      expect(paths.tmp).toBeTruthy()
      expect(await Bun.file(path.join(root, "state", APP_DIRNAME, "service-local.json") /* fork_change */).exists()).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

async function cli(args: string[], env?: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
