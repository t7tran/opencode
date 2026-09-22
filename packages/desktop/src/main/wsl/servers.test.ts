import { expect, test } from "bun:test"
import type { WslServerConfig } from "@opencode/app/wsl/types"
import { Effect, FileSystem, Path } from "effect"
import { NodeServices } from "@effect/platform-node"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { testEffect } from "../../../../core/test/lib/effect"
import { wslCliInstallCommand } from "./runtime"
import { createWslServersController } from "./servers"

type ControllerOptions = Parameters<typeof createWslServersController>[0]

let persistedServers: WslServerConfig[] = []

const it = testEffect(NodeServices.layer)
// Execute the Linux-side installer fixture locally rather than requiring a WSL distro.
const posix = process.platform === "win32" ? it.live.skip : it.live

// fork_change start - upstream's test drives its own `install` shell script end
// to end through a fake curl. This fork does not use that script: the installer
// path is `npm install -g genixcode@<version>` (see src/main/remote/cli.ts),
// because upstream's installer puts the *public* OpenCode CLI in the distro —
// a build with neither the provider lock nor the managed key file. What is worth
// pinning is that the generated command installs the fork's package and verifies
// the fork's binary, so a rebase cannot quietly restore upstream's installer.
posix(
  "installs through the fork's npm package, never upstream's install script",
  Effect.gen(function* () {
    const command = wslCliInstallCommand({ version: "0.0.0-dev-16365", binary: "C:\\local build's\\genixcode" })

    expect(command).toContain("npm install -g")
    expect(command).toContain("genixcode@0.0.0-dev-16365")
    expect(command).toContain("command -v genixcode")
    expect(command).not.toContain("opencode.ai")
    expect(command).not.toContain("githubusercontent.com")
    expect(command).not.toContain("anomalyco")
  }),
)
// fork_change end

test("installs and verifies the bundled CLI version", async () => {
  persistedServers = []
  const installs: string[][] = []
  const controller = await Effect.runPromise(
    createWslServersController(
      testControllerOptions({
        installCli: async (distro, cli) => {
          installs.push([distro, cli.version])
        },
        resolveCli: async () => "/home/me/.opencode/bin/opencode",
      }),
    ),
  )

  await controller.installOpencode("Debian")

  expect(installs).toEqual([["Debian", "0.0.0-dev-16365"]])
  expect(controller.getState().opencodeChecks.Debian?.matchesDesktop).toBe(true)
})

test("rejects a WSL CLI version that differs from the bundled version", async () => {
  persistedServers = []
  const controller = await Effect.runPromise(
    createWslServersController(
      testControllerOptions({
        installCli: async () => undefined,
        resolveCli: async () => "/home/me/.opencode/bin/opencode",
        readCliVersion: async () => "0.0.0-dev-older",
      }),
    ),
  )

  // fork_change - native copy is rebranded on the way out of nativeT(); see packages/util/src/fork/brand.ts
  await expect(controller.installOpencode("Debian")).rejects.toThrow(
    "GenixCode update finished but Debian still reports 0.0.0-dev-older; expected 0.0.0-dev-16365", // fork_change
  )
})

test("stops a running WSL server before replacing its CLI", async () => {
  persistedServers = [{ id: "wsl:Debian", distro: "Debian" }]
  const events: string[] = []
  const controller = await Effect.runPromise(
    createWslServersController(
      testControllerOptions({
        spawnSidecar: async () => {
          events.push("start")
          return {
            stop: async () => {
              events.push("stop")
            },
            onExit: () => undefined,
            url: "http://127.0.0.1:4096",
            password: "secret",
          }
        },
        installCli: async () => {
          events.push("install")
        },
      }),
    ),
  )
  controller.startConfiguredServers()
  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "ready")
  expect(controller.getState().servers[0]?.runtime).toEqual({
    kind: "ready",
    url: "http://127.0.0.1:4096",
    password: "secret",
  })

  await controller.installOpencode("Debian")

  expect(events).toEqual(["start", "stop", "install", "start"])
  await controller.stopServers()
})

test("stops a sidecar that finishes starting after shutdown", async () => {
  persistedServers = [{ id: "wsl:Debian", distro: "Debian" }]
  const stopped: string[] = []
  let resolveSidecar: ((sidecar: Awaited<ReturnType<ControllerOptions["spawnSidecar"]>>) => void) | undefined
  const controller = await Effect.runPromise(
    createWslServersController(
      testControllerOptions({
        spawnSidecar: () => new Promise((resolve) => (resolveSidecar = resolve)),
      }),
    ),
  )
  controller.startConfiguredServers()
  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "starting")

  await controller.stopServers()
  resolveSidecar?.({
    stop: async () => {
      stopped.push("stop")
    },
    onExit: () => undefined,
    url: "http://127.0.0.1:4096",
    password: "secret",
  })
  await waitFor(() => stopped.length === 1)

  expect(stopped).toEqual(["stop"])
})

test("probes addable distros in parallel before checking OpenCode", async () => {
  persistedServers = []
  const started: string[] = []
  const release = new Map<string, () => void>()
  const opencode: string[] = []
  const controller = await Effect.runPromise(
    createWslServersController(
      testControllerOptions({
        spawnSidecar: pendingSidecar,
        probeDistro: async (distro) => {
          started.push(distro)
          await new Promise<void>((resolve) => release.set(distro, resolve))
          return { name: distro, canExecute: true, hasBash: true, hasCurl: true, error: null }
        },
        resolveCli: async (distro) => {
          opencode.push(distro)
          return "/home/me/.opencode/bin/opencode"
        },
      }),
    ),
  )

  const task = controller.probeAddable(["Debian", "Ubuntu"])
  await waitFor(() => started.length === 2)
  expect(started).toEqual(["Debian", "Ubuntu"])
  expect(opencode).toEqual([])
  release.get("Debian")?.()
  release.get("Ubuntu")?.()
  await task

  expect(Object.keys(controller.getState().distroProbes)).toEqual(["Debian", "Ubuntu"])
  expect(opencode).toEqual(["Debian", "Ubuntu"])
  expect(Object.keys(controller.getState().opencodeChecks)).toEqual(["Debian", "Ubuntu"])
})

test("does not check OpenCode in addable distros that cannot execute commands", async () => {
  persistedServers = []
  const opencode: string[] = []
  const controller = await Effect.runPromise(
    createWslServersController(
      testControllerOptions({
        spawnSidecar: pendingSidecar,
        probeDistro: async (distro) => ({
          name: distro,
          canExecute: distro === "Debian",
          hasBash: distro === "Debian",
          hasCurl: distro === "Debian",
          error: distro === "Debian" ? null : "Open Ubuntu once to finish setup",
        }),
        resolveCli: async (distro) => {
          opencode.push(distro)
          return "/home/me/.opencode/bin/opencode"
        },
      }),
    ),
  )

  await controller.probeAddable(["Debian", "Ubuntu"])

  expect(Object.keys(controller.getState().distroProbes)).toEqual(["Debian", "Ubuntu"])
  expect(opencode).toEqual(["Debian"])
  expect(Object.keys(controller.getState().opencodeChecks)).toEqual(["Debian"])
})

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}

function testControllerOptions(overrides: Partial<ControllerOptions> = {}): ControllerOptions {
  return {
    cli: { version: "0.0.0-dev-16365" },
    installCli: async () => undefined,
    installDistro: async () => undefined,
    spawnSidecar: async () => ({
      stop: async () => undefined,
      onExit: () => undefined,
      url: "http://127.0.0.1:4096",
      password: "secret",
    }),
    readServers: () => persistedServers,
    writeServers: (servers: WslServerConfig[]) => {
      persistedServers = servers
    },
    readCliVersion: async () => "0.0.0-dev-16365",
    resolveCli: async () => "/home/me/.opencode/bin/opencode",
    ...overrides,
  }
}

const pendingSidecar = async () => new Promise<never>(() => undefined)
