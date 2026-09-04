// fork_change - new file
//
// Renderer-side fork policy.
//
// The web UI in this package is also the desktop app's renderer, so it is where
// the fork's server-side rules have to show up as removed affordances. Nothing
// here enforces anything — the server refuses the calls regardless — it only
// keeps the UI from offering controls that cannot work.
//
// When /etc/kilo.key supplies the Genix credential the user does not own it:
// the server refuses `auth.set` and `auth.remove`, and the provider is
// permanently connected. The UI must therefore not offer to connect or
// disconnect it — the affordances would only produce a 400. See FORK.md
// § Managed API key file.
//
// This package is shared with the web app, which has no Electron preload and
// no way to read the file, so the answer is false there and the affordances
// stay as upstream wrote them. The server refusal is the actual enforcement;
// this only removes dead controls.

export function forkManagedKey(): boolean {
  if (typeof window === "undefined") return false
  return window.api?.forkManagedKey === true
}

/**
 * True whenever this build is the fork — which is always, in this tree.
 *
 * The provider lock is unconditional here: only the Genix provider can be
 * listed, authorized or used, and the server rejects every other provider id at
 * the handler layer. Affordances that only make sense with a provider catalogue
 * — browsing "all providers", adding a custom OpenAI-compatible one — are dead
 * controls in this build regardless of whether a managed key is present.
 *
 * The lock has a test escape hatch (KILO_FORK_DISABLE_PROVIDER_LOCK), but it is
 * read server-side; a browser renderer has no process env to consult, so this is
 * a constant rather than a call into packages/core/src/fork/lock.ts.
 */
export function forkProviderLocked(): boolean {
  return true
}

/**
 * Whether to fetch and show release notes on startup.
 *
 * Upstream pulls its changelog from opencode.ai. That request would announce
 * every Genix install to upstream's site and then show OpenCode's release notes
 * inside a Genix build. There is no fork changelog feed to point at instead, so
 * the feature is off — the same reasoning as the models.dev catalogue fetch,
 * which packages/opencode/src/fork/preload.ts disables.
 */
export function forkReleaseNotesEnabled(): boolean {
  return false
}

/**
 * External support/feedback destination, or undefined when there is none.
 *
 * Upstream's Help affordances open https://opencode.ai/desktop-feedback, and its
 * error page invites the user to report the failure on upstream's Discord.
 * Neither is somewhere an internal Genix build should send its users or their
 * bug reports; support for this build goes through internal channels (see
 * README.md). Every Help control checks this, so pointing it at an internal URL
 * one day turns them all back on at once.
 */
export function forkSupportURL(): string | undefined {
  return undefined
}

/**
 * Open the support destination, if this build has one.
 *
 * Takes the opener rather than reaching for the platform context so it can be
 * called from anywhere, including a JSX attribute where a multi-line handler
 * would not fit.
 */
export function openForkSupport(open: (url: string) => void): void {
  const url = forkSupportURL()
  if (url) open(url)
}
