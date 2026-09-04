// fork_change - new file
//
// Main-process fork policy for the desktop app.
//
// Holds the two decisions the Electron shell has to make that upstream does not:
// which sidecar may run, and whether the renderer should be told that the Genix
// API key is managed.
//
// The server already refuses `auth.set` and `auth.remove` outright while a
// managed key is in play, and the TUI suppresses its connect dialog for the same
// reason (see FORK.md § Managed API key file). The desktop renderer needs the
// same signal so it can drop the connect and disconnect affordances instead of
// walking the user into a 400.
//
// The renderer cannot read the key file itself — it is a browser context — and
// the answer has to be available synchronously while the settings pane renders,
// so it is served over a sync IPC channel and read once when the preload loads.
//
// Only the boolean crosses the boundary. The key never does: `provider.list`
// redacts it for exactly the same reason.

import { ipcMain } from "electron"
import { lockedProviderManaged } from "@opencode-ai/core/fork/lock"

export const FORK_MANAGED_KEY_CHANNEL = "fork-managed-key"

export function registerForkManagedKeyChannel() {
  ipcMain.on(FORK_MANAGED_KEY_CHANNEL, (event) => {
    try {
      event.returnValue = lockedProviderManaged()
    } catch {
      // A missing or unreadable key file is the normal interactive-login case.
      event.returnValue = false
    }
  })
}

/**
 * Which agent process backs the app.
 *
 * "v1" is the server bundled from packages/opencode — forked code, so it carries
 * the provider lock and the managed key file. "v2" is upstream's separately
 * published CLI, which carries neither, and which this build no longer bundles
 * (see scripts/utils.ts). Upstream picks between them with OPENCODE_SIDECAR_V2;
 * here the choice is fixed so that env var cannot start an unlocked agent.
 *
 * A function rather than a constant so the v2 branch upstream still owns keeps
 * type-checking instead of being narrowed away — that branch should merge
 * cleanly on the next rebase, not disappear.
 */
export function forkSidecarVersion(): "v1" | "v2" {
  return "v1"
}

/**
 * Whether to run upstream's one-time migration from the Tauri-era OpenCode
 * desktop app into the Electron one.
 *
 * This fork has no such lineage. The directories that migration reads belong to
 * upstream's application, and importing another app's settings and session data
 * on first launch is not something a Genix build should do — least of all from a
 * build Genix employees are told not to install.
 */
export function forkTauriMigrationEnabled(): boolean {
  return false
}
