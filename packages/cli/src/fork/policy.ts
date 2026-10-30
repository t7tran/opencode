// fork_change - new file
//
// CLI-side fork policy.
//
// The desktop app's updater extension has the same decision in
// `packages/gui-extensions/src/updater/fork-policy.ts` and the renderer has its
// own in `packages/app/src/fork/policy.ts`. This is the CLI's.
//
// See FORK.md § What no longer reaches upstream.

import { CLI_NAME, PRODUCT_NAME } from "@opencode/util/fork/brand"

/**
 * Whether this build may check for, download, or install updates.
 *
 * Upstream's updater asks `opencode.ai/update/api/...` what the latest release
 * is and, for a `curl` install, pipes `opencode.ai/v2/install` into bash. Both
 * point at upstream's infrastructure, so leaving them on would let a Genix build
 * quietly replace itself with the public OpenCode CLI — the binary that carries
 * neither the provider lock nor the managed key file. It is the same hazard the
 * desktop app's missing `publish` block guards against, and the same reasoning:
 * an update feed pointed at upstream turns a Genix build into an OpenCode one.
 *
 * The fork publishes its CLI to npm as `genixcode`
 * (`packages/cli/script/fork-publish.ts`), so upgrading is `npm install -g
 * genixcode@<version>` — the same command the remote and WSL installers use.
 * There is no fork update feed for the client to poll, so the feature is off
 * rather than repointed.
 *
 * **Compile-time only.** This deliberately reads a build-time `define` rather
 * than an environment variable. An env switch ships inside the binary, so
 * anything that can set one in the process environment — a wrapper script, a CI
 * job, a compromised shell profile — could turn the updater back on and point a
 * Genix install at upstream. There is no env var to set here: the value is
 * substituted at build time and the dead branch is eliminated. This is stricter
 * than the provider lock's `GENIXCODE_FORK_DISABLE_PROVIDER_LOCK`, which does ship as
 * an env switch, and stricter on purpose — the lock's hatch degrades a running
 * session, this one would replace the binary.
 *
 * Absent means an unbuilt run — `bun test`, `bun dev` — and the answer there is
 * still *off*. A build that somehow skipped the `define` gets the safe value
 * rather than a self-updating binary, so this fails closed the way
 * `requirePepper()` does.
 *
 * Upstream's own updater tests cover per-package-manager install commands this
 * fork does not change, and they mock `globalThis.fetch`, so they never reach
 * upstream either way. They run with `--define GENIX_UPDATER_ENABLED=true` from
 * `test/fork-run.ts` so that coverage survives the feature being disabled.
 *
 * A function rather than a constant so the disabled branches upstream still owns
 * keep type-checking instead of being narrowed away — they should merge cleanly
 * on the next rebase, not disappear. Giving this a fork feed one day turns the
 * whole updater back on at once.
 */
declare const GENIX_UPDATER_ENABLED: boolean | undefined

export function forkUpdaterEnabled(): boolean {
  return typeof GENIX_UPDATER_ENABLED === "boolean" ? GENIX_UPDATER_ENABLED : false
}

/** What to tell a user who asked to upgrade. Names the supported path. */
export function forkUpgradeRefusal(): string {
  return "This build does not self-update. Upgrade with `npm install -g genixcode@<version>`."
}

/**
 * Whether the background service may publish itself to the internet.
 *
 * Upstream v2.1 added remote access (`pair --remote`, `service set remote true`): the service dials a
 * third-party relay (`@opentunnel/client`) and becomes reachable at a public URL. The server behind it holds
 * the managed Genix key and the user's workspace, so an internet-facing address is a new way out that none of
 * the fork's guarantees cover, and it depends on infrastructure the fork does not own. Pairing on the local
 * network (`pair` without `--remote`) still works.
 *
 * A plain constant rather than a build `define`: unlike the updater, no upstream test needs the feature on —
 * the ones that would open a real tunnel were never in the suite. See FORK.md § Remote access is off.
 */
export function forkRemoteAccessEnabled(): boolean {
  return false
}

/** What to tell a user who asked for remote access. Names the supported path. */
export function forkRemoteAccessRefusal(): string {
  return `Remote access is disabled in this build: it would publish the ${PRODUCT_NAME} server through a third-party tunnel. Pair on the local network with \`${CLI_NAME} pair\` instead.`
}
