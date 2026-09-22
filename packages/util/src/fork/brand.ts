// fork_change - new file
//
// Brand identity for this fork of anomalyco/opencode.
//
// Upstream ships as "OpenCode"; this fork ships as "GenixCode". The CLI, the
// TUI wordmark and the run splash carry the change as hand-edited literals
// because there are only a handful of them (see FORK.md § Branding). The
// desktop app and the web UI cannot work that way: their user-visible copy
// lives in ~65 locale dictionaries per package, and rewriting every one of them
// would swap a three-line diff for a several-thousand-line one that conflicts
// on every upstream translation update.
//
// So the desktop/web rename happens at the seam instead: dictionaries are piped
// through `rebrandDict()` as they are loaded, and the packaging identity comes
// from the constants below rather than from literals scattered across the
// Electron config, the metainfo generator and the main process.
//
// This module must stay dependency-free — it is imported by the Electron main
// process, by build scripts, and by browser renderer code.
//
// See FORK.md.

/** Genix brand blue. Matches the TUI wordmark and the run splash. */
export const BRAND_COLOR = "#0186CD"

/** Product name shown to users. Upstream: "OpenCode". */
export const PRODUCT_NAME = "GenixCode"

/**
 * Upstream's product name, spelled out for copy that must keep saying it.
 *
 * Attribution is the one place the rename must not reach: the About screen
 * credits upstream's authors, links upstream's site and names upstream's
 * trademark holder. See `VERBATIM_KEY_PREFIXES` below.
 */
export const UPSTREAM_PRODUCT_NAME = "OpenCode"

/** Company/vendor name, for packaging metadata. */
export const VENDOR_NAME = "Genix Ventures"

/** Executable name of the CLI this fork ships. */
export const CLI_NAME = "genixcode"

/** Deep-link scheme. Upstream: "opencode". */
export const PROTOCOL_SCHEME = "genixcode"

/**
 * Name of the per-user application directory, used for the XDG data, cache,
 * config and state roots: `~/.config/genixcode`, `~/.local/share/genixcode`,
 * and so on. Upstream: "opencode".
 */
export const APP_DIRNAME = CLI_NAME

/**
 * Home-level configuration dotdir, scanned alongside the XDG config directory
 * for `opencode.json`, `tui.json`, skills, commands, agents, plugins and
 * themes. Upstream: ".opencode".
 */
export const HOME_CONFIG_DIRNAME = `.${CLI_NAME}`

/** Reverse-DNS base for desktop application ids. Upstream: "ai.opencode.desktop". */
export const APP_ID_BASE = "com.genixventures.genixcode"

/** Homepage recorded in packaging metadata. */
export const HOMEPAGE = "https://genixventures.com"

/**
 * The one line the About screen adds to upstream's copy.
 *
 * Everything else on that screen stays as upstream wrote it, so this is the
 * only thing telling a user which build they are actually running. Assembled
 * from the constants above rather than written out, so it cannot drift from
 * the name the app installs under.
 */
export const FORK_NOTICE = `${PRODUCT_NAME}, a fork of ${UPSTREAM_PRODUCT_NAME} by ${VENDOR_NAME}`

/** Release channels, as upstream names them. */
export type Channel = "dev" | "beta" | "prod"

export function isChannel(value: unknown): value is Channel {
  return value === "dev" || value === "beta" || value === "prod"
}

export function resolveChannel(value: unknown): Channel {
  if (isChannel(value)) return value
  if (value === "latest") return "prod"
  return "dev"
}

/** Application id for a channel, e.g. "com.genixventures.genixcode.beta". */
export function appId(channel: Channel): string {
  return channel === "prod" ? APP_ID_BASE : `${APP_ID_BASE}.${channel}`
}

/** Product name for a channel, e.g. "GenixCode Beta". */
export function productName(channel: Channel): string {
  return channel === "prod" ? PRODUCT_NAME : `${PRODUCT_NAME} ${channel.charAt(0).toUpperCase()}${channel.slice(1)}`
}

/** Linux package name for a channel, e.g. "genixcode-beta". */
export function packageName(channel: Channel): string {
  return channel === "prod" ? CLI_NAME : `${CLI_NAME}-${channel}`
}

// Ordered longest-match-first. "OpenCode Zen" and "OpenCode Go" are upstream's
// hosted model service and subscription; a build locked to the Genix gateway
// never reaches either, but neither name should survive as "GenixCode Zen" or
// "GenixCode Go" in a string that does leak through.
const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/OpenCode Zen/g, "Genix"],
  [/OpenCode Go/g, "Genix"],
  [/opencode zen/g, "genix"],
  [/OpenCode/g, PRODUCT_NAME],
  [/Opencode/g, "Genixcode"],
  [/OPENCODE/g, "GENIXCODE"],
  [/opencode/g, CLI_NAME],
]

/**
 * Rewrite upstream's product name out of a user-visible string.
 *
 * Applied to translated copy only — never to identifiers, keys, URLs or
 * provider ids. Dictionary *keys* (`dialog.provider.opencode.note`) are left
 * alone by `rebrandDict()` for exactly that reason.
 */
export function rebrand(text: string): string {
  let out = text
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement)
  return out
}

/**
 * Dictionary key prefixes whose copy keeps upstream's wording verbatim.
 *
 * `settings.about.*` is the desktop About screen, and it is credits and
 * attribution rather than product copy: it names upstream's authors, links
 * `www.opencode.ai`, and states that OpenCode is Anomaly Innovations'
 * registered trademark. Running those through `rebrand()` produces a dead
 * domain and a trademark claim on a name this fork does not own — so the
 * screen keeps upstream's text, changes its wordmark, and adds `FORK_NOTICE`
 * to say which build the user is looking at. See FORK.md § The About screen.
 */
const VERBATIM_KEY_PREFIXES = ["settings.about."] as const

/** True for a dictionary key whose value must survive `rebrandDict()` unchanged. */
export function verbatimKey(key: string): boolean {
  return VERBATIM_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Rebrand every string value of a flat translation dictionary, leaving keys,
 * non-string values and `verbatimKey()` entries untouched. Returns the input
 * unchanged (same reference) when nothing matched, so warm dictionaries are not
 * needlessly copied.
 */
export function rebrandDict<T extends Record<string, unknown>>(dict: T): T {
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== "string" || verbatimKey(key)) {
      out[key] = value
      continue
    }
    const next = rebrand(value)
    if (next !== value) changed = true
    out[key] = next
  }
  return changed ? (out as T) : dict
}
