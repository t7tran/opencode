// fork_change start - upstream downloads a prebuilt v2 CLI ("opencode-cli", the
// `@opencode-ai/cli-<platform>` npm packages) and bundles it beside the app, so
// the desktop shell can run its agent out of process.
//
// This fork does not ship it. That binary is built and published by upstream, so
// it carries neither the provider lock nor the managed key file — bundling it
// would put an unlocked agent, pointed at upstream's cloud, inside a locked
// build. The v2 sidecar is disabled in src/main/index.ts; the desktop app runs
// the embedded server built from packages/opencode, which is forked code.
//
// What remains here is the channel helper the other scripts share, plus
// RUST_TARGET, which copy-bundles.ts uses to name CI artefacts. The CLI download
// and the target/package table it needed are gone; restore them from upstream
// only alongside a fork-built CLI.
export type Channel = "dev" | "beta" | "prod"

export const RUST_TARGET = Bun.env.RUST_TARGET

export function resolveChannel(): Channel {
  const raw = Bun.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
// fork_change end
