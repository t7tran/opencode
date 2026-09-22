export * as DesktopCli from "./desktop-cli"

import { execFile, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Option, Path } from "effect"
import installer from "../../../../../install?raw"
import { DesktopPaths } from "../paths"
import { BUNDLED_CLI_VERSION_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { parseCliVersion } from "./cli-version"
import { CLI_NAME, HOME_CONFIG_DIRNAME } from "@opencode/util/fork/brand" // fork_change
import { channelFromVersion } from "@opencode/util/fork/service-registration" // fork_change - the registration file is named after this channel

const execFileAsync = promisify(execFile)

export interface Resolved {
  readonly version: string
  // fork_change start - the release channel this CLI was built on, which decides
  // the name of the registration file it writes. Derived from the version for a
  // bundled binary; a CLI run from source carries no OPENCODE_CHANNEL define and
  // so is always "local", whatever OPENCODE_VERSION says.
  readonly channel: string
  // fork_change end
  readonly command: readonly string[]
  readonly binary?: string
  readonly wslBuild?: { readonly script: string; readonly output: string }
}

export interface Interface {
  readonly resolve: Effect.Effect<Resolved>
  readonly install: Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopCli") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path
    const resolve = yield* Effect.cached(
      make().pipe(Effect.provide(yield* Effect.context<FileSystem.FileSystem | Path.Path>()), Effect.orDie),
    )
    const install = Effect.gen(function* () {
      if (process.platform !== "darwin") return yield* Effect.fail(new Error("CLI installation requires macOS"))
      const cli = yield* resolve
      if (!cli.binary) return yield* Effect.fail(new Error("Bundled CLI executable is unavailable"))
      const home = app.getPath("home")
      yield* runInstaller(cli.binary, home)
      return path.join(home, HOME_CONFIG_DIRNAME, "bin", CLI_NAME) // fork_change - renamed binary and install dir
    })
    return Service.of({ resolve, install })
  }),
)

const make = Effect.fn("DesktopCli.resolve")(function* () {
  const development = !app.isPackaged && process.env.OPENCODE_DESKTOP_CLI_DEV
  const version = process.env.OPENCODE_VERSION ?? "local"
  const cli = development
    ? {
        version,
        channel: "local", // fork_change - no OPENCODE_CHANNEL define when run from source
        command: [
          "bun",
          "run",
          "--cwd",
          development,
          `--define=OPENCODE_VERSION=${JSON.stringify(version)}`,
          "src/index.ts",
        ],
        binary: undefined,
      }
    : yield* resolveBundledCli(!app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1")
  return {
    ...cli,
    wslBuild:
      app.isPackaged || !process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD || !process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT
        ? undefined
        : {
            script: process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD,
            output: process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT,
          },
  } satisfies Resolved
})

const resolveBundledCli = Effect.fn("DesktopCli.resolveBundled")(function* (isolated: boolean) {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, executableName())
    : path.join(paths.developmentResourcesRoot, isolated ? developmentExecutableName() : executableName())
  yield* Effect.logInfo("v2 CLI executable resolved", { bundled, packaged: app.isPackaged })
  const version = yield* bundledVersion(bundled)
  const binary = app.isPackaged || isolated ? yield* installCli(bundled, version) : bundled
  return { version, channel: yield* bundledChannel(bundled, version), binary, command: [binary] } // fork_change - channel names the registration file
})

// Spawning the bundled executable for `--version` costs ~400 ms of startup on a 200 MB binary (and
// several seconds on the first launch after an update, while the antivirus scans it). The build
// writes the version next to the executable, so a packaged app never spawns; the per-identity cache
// covers executables that arrived without that file.
const bundledVersion = Effect.fn("DesktopCli.bundledVersion")(function* (bundled: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  // Synchronous on purpose: this sits on the path to the first window's IPC port, and a queued
  // async read waits behind everything else the main thread is doing at that moment.
  const shipped = yield* Effect.sync(() => {
    try {
      return readFileSync(path.join(path.dirname(bundled), "opencode-cli.version"), "utf8").trim()
    } catch {
      return ""
    }
  })
  if (shipped) {
    yield* Effect.logInfo("v2 CLI version bundled", { version: shipped })
    return shipped
  }
  const stat = yield* fs.stat(bundled).pipe(Effect.orElseSucceed(() => undefined))
  const identity = stat ? `${stat.size}:${Option.getOrUndefined(stat.mtime)?.getTime() ?? ""}` : undefined
  const store = getStore()
  const cached = store.get(BUNDLED_CLI_VERSION_KEY)
  if (identity && isVersionCache(cached) && cached.path === bundled && cached.identity === identity) {
    yield* Effect.logInfo("v2 CLI version reused", { version: cached.version })
    return cached.version
  }
  const version = parseCliVersion(yield* run(bundled, ["--version"]))
  if (identity) store.set(BUNDLED_CLI_VERSION_KEY, { path: bundled, identity, version } satisfies VersionCache)
  return version
})

// fork_change start - the channel the bundled CLI was built on, which names the
// registration file it writes (see util/src/fork/service-registration.ts). The build
// records it next to the version; channelFromVersion is only a fallback, and a lossy
// one: it reads a plain-semver release as "latest", while this fork ships its releases
// on "prod". Getting it wrong is silent — ensure() waits on a file nobody writes while
// each spawned CLI finds its own registration and exits 0 — so log which source won.
const bundledChannel = Effect.fn("DesktopCli.bundledChannel")(function* (bundled: string, version: string) {
  const path = yield* Path.Path
  // Synchronous for the same reason as bundledVersion: this is on the first window's IPC path.
  const shipped = yield* Effect.sync(() => {
    try {
      return readFileSync(path.join(path.dirname(bundled), "opencode-cli.channel"), "utf8").trim()
    } catch {
      return ""
    }
  })
  const channel = shipped || channelFromVersion(version)
  yield* Effect.logInfo("v2 CLI channel resolved", { channel, shipped: !!shipped })
  return channel
})
// fork_change end

type VersionCache = { path: string; identity: string; version: string }

function isVersionCache(value: unknown): value is VersionCache {
  if (!value || typeof value !== "object") return false
  const cache = value as Record<string, unknown>
  return typeof cache.path === "string" && typeof cache.identity === "string" && typeof cache.version === "string"
}

export const cleanStages = Effect.fn("DesktopCli.cleanStages")(function* (binary: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const current = path.dirname(binary)
  const root = path.dirname(current)
  const entries = yield* fs.readDirectory(root)
  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* (entry) {
      const target = path.join(root, entry)
      if (target === current) return
      const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => undefined))
      if (stat?.type !== "Directory") return
      yield* fs
        .remove(target, { recursive: true, force: true })
        .pipe(Effect.catch((error) => Effect.logError("failed to clean staged v2 CLI", { path: target, error })))
    }),
    { concurrency: "unbounded" },
  )
})

const installCli = Effect.fn("DesktopCli.install")(function* (source: string, version: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = path.join(directory, executableName())
  if (existsSync(destination)) {
    yield* Effect.logInfo("v2 CLI staged executable reused", { path: destination, version })
    return destination
  }

  const temp = destination + `.${process.pid}.tmp`
  yield* fs.makeDirectory(directory, { recursive: true })
  yield* fs.copyFile(source, temp)
  if (process.platform !== "win32") yield* fs.chmod(temp, 0o755)
  yield* fs
    .rename(temp, destination)
    .pipe(Effect.catch((error) => fs.remove(temp, { force: true }).pipe(Effect.andThen(Effect.fail(error)))))
  yield* Effect.logInfo("v2 CLI executable staged", { source, path: destination, version })
  return destination
})

const run = Effect.fn("DesktopCli.run")(function* (binary: string, args: string[]) {
  yield* Effect.logInfo("v2 CLI command started", { binary, args })
  const result = yield* Effect.tryPromise(() => execFileAsync(binary, args, { windowsHide: true })).pipe(
    Effect.tapError((error) => {
      const output = error as { stdout?: string; stderr?: string }
      return Effect.logError("v2 CLI command failed", {
        args,
        error: error instanceof Error ? error.message : String(error),
        stdout: output.stdout?.trim() ?? "",
        stderr: output.stderr?.trim() ?? "",
      })
    }),
  )
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()
  yield* Effect.logInfo("v2 CLI command completed", { args, stdout, stderr })
  return stdout
})

const runInstaller = Effect.fn("DesktopCli.installForUser")(function* (binary: string, home: string) {
  yield* Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("/bin/bash", ["-s", "--", "--binary", binary], {
          env: { ...process.env, HOME: home },
          stdio: ["pipe", "ignore", "pipe"],
        })
        let stderr = ""
        child.stderr.on("data", (chunk) => (stderr += chunk))
        child.on("error", reject)
        child.on("close", (code) => {
          if (code === 0) return resolve()
          reject(new Error(stderr.trim() || `CLI installer exited with code ${code}`))
        })
        child.stdin.end(installer)
      }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
})

function executableName() {
  return process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli"
}

function developmentExecutableName() {
  return process.platform === "win32" ? "opencode-cli-dev.exe" : "opencode-cli-dev"
}
