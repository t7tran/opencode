// fork_change - new file
//
// Opening a folder from a link.
//
// A workspace landing page wants to send someone straight into an agent's
// folder: `https://<host>/open?dir=~/agents/writer` in the browser, or
// `genixcode://open?dir=~/agents/writer` for the desktop app. Without `new=1`
// the link resumes the newest session in that folder (or a draft already open
// there) and only starts a fresh one when there's nothing to resume. With it,
// every click is a new session. See FORK.md § Opening a folder from a link.
//
// This file is the pure half: reading the link, expanding `~` against the
// server's home folder and picking what to resume. `open-route.tsx` does the
// talking to the server and the tabs.

import { PROTOCOL_SCHEME } from "@opencode/util/fork/brand"
import { pathKey } from "@/workspaces/path-key"

export const OPEN_ROUTE = "/open"

export type OpenRequest = {
  /** The folder as written in the link, `~` and all. */
  readonly dir: string
  /** Start a new session even when one already exists there. */
  readonly fresh: boolean
}

const FLAG_ON = new Set(["", "1", "true", "yes"])

export function parseOpenRequest(search: {
  dir?: string | string[]
  new?: string | string[]
}): OpenRequest | undefined {
  const dir = first(search.dir)?.trim()
  if (!dir) return
  const flag = first(search.new)
  return { dir, fresh: flag !== undefined && FLAG_ON.has(flag.trim().toLowerCase()) }
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function needsHome(dir: string) {
  return dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\")
}

/**
 * The absolute folder a link points at, or undefined when it can't be one:
 * a relative path, `~user/…`, or `~` with no home folder to expand it against.
 */
export function resolveOpenDirectory(dir: string, home: string | undefined) {
  const expanded = needsHome(dir) ? (home ? join(home, dir.slice(2)) : undefined) : dir
  if (!expanded || !isAbsolute(expanded)) return
  const key = pathKey(expanded)
  // pathKey only trims trailing slashes; keep the caller's separators otherwise.
  return key === "/" || /^[A-Za-z]:\/$/.test(key) ? key : expanded.replace(/[\\/]+$/, "")
}

function join(home: string, rest: string) {
  const base = home.replace(/[\\/]+$/, "")
  if (!rest) return base
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/"
  return `${base}${sep}${rest.replace(/^[\\/]+/, "")}`
}

function isAbsolute(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
}

type ResumableSession = {
  readonly id: string
  readonly parentID?: string
  readonly location: { readonly directory: string }
  readonly time: { readonly created: number; readonly updated?: number; readonly archived?: number }
}

/**
 * The session a link without `new=1` resumes: the most recently updated
 * top-level session in exactly this folder. Subfolders and linked worktrees
 * have their own sessions; archived ones stay archived.
 */
export function latestSession<T extends ResumableSession>(sessions: readonly T[], directory: string) {
  const key = pathKey(directory)
  return sessions
    .filter((session) => !session.parentID && session.time.archived === undefined)
    .filter((session) => pathKey(session.location.directory) === key)
    .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))[0]
}

/**
 * The in-app route for a `genixcode://open?…` desktop link, or undefined for
 * any other deep link (the console sign-in return, say), which is left alone.
 */
export function openDeepLinkRoute(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }
  if (url.protocol !== `${PROTOCOL_SCHEME}:`) return
  // `genixcode://open?…` puts "open" in the host; `genixcode:open?…` in the path.
  const target = url.hostname || url.pathname.replace(/^\/+/, "")
  if (target !== "open" || (url.hostname && url.pathname.replace(/\/+$/, "") !== "")) return
  const request = parseOpenRequest({
    dir: url.searchParams.get("dir") ?? undefined,
    new: url.searchParams.get("new") ?? undefined,
  })
  if (!request) return
  return openRoute(request)
}

export function openRoute(request: OpenRequest) {
  const params = new URLSearchParams({ dir: request.dir })
  if (request.fresh) params.set("new", "1")
  return `${OPEN_ROUTE}?${params}`
}
