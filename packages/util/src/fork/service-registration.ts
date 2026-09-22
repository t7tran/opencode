// fork_change - new file
//
// Where the background service registration file lives.
//
// Upstream keeps this path in two places that never talk to each other. The CLI
// builds it from `Global.state` plus a channel-derived filename
// (`packages/cli/src/services/service-config.ts`), and any client that does not
// pass `file` explicitly falls back to a hardcoded
// `~/.local/state/opencode/service.json`
// (`packages/client/src/{promise,effect}/service.ts`). Upstream gets away with
// that because both halves happen to spell the same literal: the app directory
// is `opencode`, and every channel upstream ships — latest, dev, beta, next —
// maps back to the bare `service.json`.
//
// This fork breaks both halves of that coincidence:
//
//   - `APP_DIRNAME` moved the XDG state root to `~/.local/state/genixcode`
//     (see `global.ts`), so the CLI writes somewhere the fallback never looks.
//   - `Script.channel` falls back to the current git branch, so a local build
//     off `fork-on-v2.0.11` ships a CLI whose registration is
//     `service-fork-on-v2.0.11.json` rather than `service.json`.
//
// Either one on its own is enough to hang the desktop app on its splash screen.
// `Service.ensure()` watches a file that is never written, so it spawns the CLI
// forever; each spawn finds its *own* registration, concludes a service is
// already up, and exits 0. Nothing errors, nothing logs, and the window sits on
// the logo until the ensure deadline.
//
// So the two halves share one module now. The desktop passes the path this
// returns, and the CLI names its file through `registrationFilename` here.

import os from "node:os"
import path from "node:path"
import { APP_DIRNAME } from "./brand.js"

// Channels that register as the bare `service.json`, as upstream's
// `ServiceConfig.filename` lists them. Everything else — including this fork's
// branch-named local builds — gets a channel-suffixed file of its own, so two
// channels installed side by side never fight over one service.
const DEFAULT_CHANNELS: ReadonlySet<string> = new Set(["latest", "dev", "beta", "next"])

/** Whether `channel` registers as the bare `service.json`. */
export function isDefaultChannel(channel: string): boolean {
  return DEFAULT_CHANNELS.has(channel)
}

/** Registration filename for a release channel. */
export function registrationFilename(channel: string): string {
  if (isDefaultChannel(channel)) return "service.json"
  return `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

/**
 * The channel a CLI version string was built on, as far as the version can say.
 *
 * Preview builds are `0.0.0-<channel>-<build>` and releases are plain semver —
 * the same shape `ServiceConfig.versionBelongsToChannel` matches against. The
 * build suffix is a run number (`412`, `412.2`) or a timestamp, so the trailing
 * `-<digits>` group is what separates it from a channel name that contains
 * dashes and dots of its own, like `fork-on-v2.0.11`.
 *
 * A plain semver release carries no channel at all, so this reads it as upstream's
 * `latest`. That guess is wrong for this fork, whose release builds are made with
 * `OPENCODE_CHANNEL=prod` and therefore register as `service-prod.json` on port
 * 13420, not `service.json` on 0xc0de. It cost one shipped build a 120-second
 * splash-screen hang: the desktop watched a file nobody wrote while every CLI it
 * spawned found its own registration and exited 0, so nothing logged an error.
 *
 * Callers that can know the real channel must use it. The desktop build records
 * it beside the bundled binary as `opencode-cli.channel` (see
 * `packages/cli/script/build.ts` and `packages/desktop/scripts/utils.ts`), and
 * `DesktopCli.bundledChannel` reads that first. This function is the fallback for
 * bundles predating that file, where a preview version still answers correctly.
 */
export function channelFromVersion(version: string): string {
  const preview = /^0\.0\.0-(.+)-(\d+(?:\.\d+)?)$/.exec(version)
  if (preview) return preview[1]!
  if (version === "" || version === "local") return "local"
  return "latest"
}

/**
 * XDG state root for this fork, read at call time.
 *
 * Deliberately not cached: the desktop's isolated development mode points
 * `XDG_STATE_HOME` at the Electron userData directory after the process has
 * started, and the registration has to follow it there.
 */
export function stateRoot(): string {
  const home = os.homedir()
  const state = process.env["XDG_STATE_HOME"] || path.join(home, ".local", "state")
  return path.join(state, APP_DIRNAME)
}

/** Absolute path of the registration file for a channel. */
export function registrationFile(channel: string): string {
  return path.join(stateRoot(), registrationFilename(channel))
}
