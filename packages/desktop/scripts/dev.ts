import { $ } from "bun"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { prepareDevElectron } from "./dev-electron"
// fork_change start - `downloadCliToResources()` is deliberately gone from
// ./utils (this fork never pulls a published CLI into the bundle; see the note
// at the top of that file). The import was top-level, so `bun dev:desktop` died
// at module load with "Export named 'downloadCliToResources' not found" before
// it ran a single line — whether or not --download-server was passed. The
// download source goes with it; building from packages/cli is the only option.
type ServerSource = { type: "build" }
// fork_change end
type DevOptions = { server: ServerSource; electron: string[] }

async function main() {
  process.env.OPENCODE_CHANNEL = "local"
  process.env.OPENCODE_VERSION = `2.0.0-local-${Date.now()}`
  process.env.OPENCODE_DISABLE_CHANNEL_DB = "0"
  const options = selectOptions()
  if (options.server.type === "build") process.env.OPENCODE_DESKTOP_SERVER_CHANNEL = "local"
  process.env.OPENCODE_DESKTOP_ISOLATED_SERVER = "1"
  await prepareDesktop()
  await prepareServer(options.server)
  await startDesktop(options.electron)
}

async function prepareDesktop() {
  await Promise.all([
    $`bun run install-electron`,
    $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`,
  ])
  if (process.platform === "darwin") process.env.ELECTRON_EXEC_PATH = await prepareDevElectron()
}

function selectOptions(): DevOptions {
  const args = process.argv.slice(2)
  const build = args.indexOf("--build-server")
  // fork_change start - --download-server is gone with the helper behind it. It
  // is still accepted and rejected by name rather than silently falling through
  // to a local build, which would quietly ignore the version asked for.
  const download = args.indexOf("--download-server")
  if (download >= 0) {
    throw new Error("--download-server is not supported in this fork; the CLI is always built from packages/cli")
  }
  const consumed = new Set([build])
  // fork_change end
  return {
    server: { type: "build" }, // fork_change - the only source left
    electron: args.filter((_, index) => !consumed.has(index)),
  }
}

async function prepareServer(_source: ServerSource) { // fork_change - source is always "build" now
  process.env.OPENCODE_DESKTOP_CLI_DEV = join(import.meta.dirname, "../../cli")
  await $`bun run --cwd ${process.env.OPENCODE_DESKTOP_CLI_DEV} --define=OPENCODE_VERSION=${JSON.stringify(process.env.OPENCODE_VERSION)} src/index.ts --version`
  if (process.platform !== "win32") return
  process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD = join(import.meta.dirname, "../../cli/script/build.ts")
  process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT = join(import.meta.dirname, "../resources/opencode-cli-wsl")
}

async function startDesktop(args: string[]) {
  // Bun's implicit spawn environment omits values set during preparation.
  process.exitCode = await Bun.spawn(
    ["node", fileURLToPath(new URL("../bin/electron-vite.js", import.meta.resolve("electron-vite"))), "dev", ...args],
    { env: process.env, stdio: ["inherit", "inherit", "inherit"] },
  ).exited
}

await main()
