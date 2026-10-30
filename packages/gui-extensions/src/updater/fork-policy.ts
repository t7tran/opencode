// fork_change - new file
//
// The updater extension's fork policy: the two calls this extension makes to upstream's infrastructure. Extensions
// share only contracts, so this cannot import packages/app/src/fork/policy.ts and repeats its answer where they
// overlap. See FORK.md § What no longer reaches upstream.

/**
 * Whether electron-updater may check for, download and install updates.
 *
 * Upstream points beta and prod at anomalyco/opencode releases, so an update would quietly turn a Genix build into
 * an OpenCode one, and this fork publishes no desktop update feed of its own. The updater reports `disabled`, the
 * state upstream's unpackaged and dev builds already render. The fork used to switch this off with
 * `UPDATER_ENABLED` in packages/desktop/src/main/constants.ts, until upstream moved the updater into this extension.
 */
export function forkUpdaterEnabled(): boolean {
  return false
}

/**
 * Whether What's New fetches upstream's changelog after an update.
 *
 * The changelog lives on opencode.ai and describes OpenCode: the request would announce every Genix install to
 * upstream's site and show OpenCode's release notes inside a Genix build. Mirrors `forkReleaseNotesEnabled()` in
 * packages/app/src/fork/policy.ts.
 */
export function forkReleaseNotesEnabled(): boolean {
  return false
}
