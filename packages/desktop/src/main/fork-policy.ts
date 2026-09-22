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
import { lockedProviderManaged } from "@opencode/util/fork/lock"

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
 * Upstream v2 note: v1's `forkSidecarVersion()` and `forkTauriMigrationEnabled()`
 * lived here too.
 *
 * `forkSidecarVersion()` pinned the app to the embedded server bundled from
 * packages/opencode, so `OPENCODE_SIDECAR_V2=1` could not start upstream's
 * separately published CLI. v2 dissolved packages/opencode: the CLI sidecar is
 * the only agent there is, and the choice no longer exists. What replaces the
 * guarantee is `scripts/prebuild.ts`, which only ever bundles a CLI built from
 * packages/cli in this tree — never one downloaded from the registry.
 *
 * `forkTauriMigrationEnabled()` turned off upstream's one-time import from the
 * Tauri-era OpenCode desktop app. v2 removed that migration entirely, so there
 * is nothing left to refuse.
 */
