// fork_change start - upstream can bundle a *published* CLI beside the app:
// `downloadCliToResources()` installs the `@opencode/cli-<platform>` npm package
// from the registry and copies its binary into resources/.
//
// This fork must never do that. That binary is built and published by upstream,
// so it carries neither the provider lock nor the managed key file — bundling it
// would put an unlocked agent, pointed at upstream's infrastructure, inside a
// locked build, with nothing at runtime to tell the two apart.
//
// Upstream v2 note: v1 had a second option — an embedded server bundled from
// packages/opencode — and the fork pinned the app to it. v2 dissolved that
// package, so the CLI sidecar is the only agent there is. The fork therefore
// keeps `copyBuiltCliToResources()`, which copies a *locally built* CLI from
// packages/cli (lock and managed key included), and drops the download path.
// See FORK.md § Desktop app.
import { $ } from "bun"
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CLI_NAME } from "@opencode/util/fork/brand"
// fork_change end

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (raw === "latest") return "prod"
  return "dev"
}

export const CLI_BINARIES: Array<{ target: string; package: string; os: string; cpu: string }> = [
  {
    target: "aarch64-apple-darwin",
    package: "@opencode/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    target: "x86_64-apple-darwin",
    package: "@opencode/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    target: "aarch64-pc-windows-msvc",
    package: "@opencode/cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    target: "x86_64-pc-windows-msvc",
    package: "@opencode/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    target: "x86_64-unknown-linux-gnu",
    package: "@opencode/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    target: "aarch64-unknown-linux-gnu",
    package: "@opencode/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const CLI_TARGET = Bun.env.OPENCODE_CLI_TARGET

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = CLI_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.target === target)
  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

// fork_change start - `downloadCliToResources()` is deliberately gone; see the
// note at the top of this file. `mkdtemp`, `rm` and `tmpdir` were only used by
// it and are kept imported so the module still merges cleanly on rebase.
void mkdtemp
void rm
void tmpdir
// fork_change end

// fork_change - the only way a CLI reaches the bundle in this fork: a locally built one
export async function copyBuiltCliToResources(root: string, dest = windowsify("resources/opencode-cli")) {
  const cli = getCurrentCli()
  const directory = cli.package.replace("@opencode/", "")
  await copyCliToResources(join(root, directory), dest)
}

// The package directory is an npm package: its package.json version is the string the executable
// prints for --version. Writing it next to the executable spares the desktop a ~400 ms spawn of the
// 200 MB binary on first launch.
async function copyCliToResources(pkg: string, dest: string) {
  const cli = getCurrentCli()
  await copyFile(join(pkg, "bin", cli.os === "win32" ? `${CLI_NAME}.exe` : CLI_NAME), dest) // fork_change - renamed binary
  await prepareCli(dest)
  // fork_change - opencodeChannel is written by packages/cli/script/build.ts
  const manifest = (await Bun.file(join(pkg, "package.json")).json()) as { version?: string; opencodeChannel?: string }
  if (!manifest.version) throw new Error(`Bundled CLI package has no version: ${pkg}`)
  await Bun.write(versionFile(dest), manifest.version)
  // fork_change start - the channel decides which registration file the CLI writes,
  // and the desktop has to read the same one or it waits on a file nobody creates.
  // The version string cannot stand in for it: a release is plain semver, and this
  // fork's release channel is "prod" rather than upstream's "latest". So ship the
  // channel beside the version, the same way and for the same reason.
  if (!manifest.opencodeChannel) throw new Error(`Bundled CLI package has no channel: ${pkg}`)
  await Bun.write(channelFile(dest), manifest.opencodeChannel)
  // fork_change end
}

export function versionFile(cli: string) {
  return join(dirname(cli), "opencode-cli.version")
}

// fork_change start - sibling of versionFile; see copyCliToResources above.
export function channelFile(cli: string) {
  return join(dirname(cli), "opencode-cli.channel")
}
// fork_change end

async function prepareCli(dest: string) {
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
