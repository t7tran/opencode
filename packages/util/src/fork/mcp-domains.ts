// fork_change - new file
//
// The outbound domain allowlist for remote MCP servers.
//
// The provider lock used to refuse every integration but Genix's, and MCP
// servers register integrations of their own, so a locked build could not
// authorise one at all. MCP is allowed now; what an administrator controls
// instead is *where* it may connect. A root-owned file lists the domains a
// remote MCP server, and everything the MCP layer fetches on its behalf (OAuth
// discovery, client registration, token exchange and refresh), may reach.
//
//   /etc/genixcode.domains          GENIXCODE_FORK_DOMAINS_FILE overrides the path
//
//   # one entry per line; blank lines and # comments are ignored
//   mcp.example.com                 that host exactly
//   *.example.com                   any subdomain of example.com (not example.com itself)
//
// No file means no restriction, the same as an upstream build — dropping the
// file in is what locks a host down, the way dropping in /etc/kilo.key manages
// its key. A file that exists but cannot be read allows nothing: an
// administrator who wrote one meant to restrict, and a permissions mistake
// should not silently lift it. Loopback is always allowed, because a server on
// 127.0.0.1 is not outbound traffic.
//
// Only remote MCP servers are covered. A local (stdio) MCP server is a process
// the user configured, and what it connects to is outside this process's reach.
//
// See FORK.md § MCP outbound domains.

import fs from "node:fs"
import { isLoopbackHostname } from "./server-auth.js"

export const DEFAULT_DOMAINS_FILE = "/etc/genixcode.domains"

/** Absolute path of the allowlist file. */
export function domainsFilePath(): string {
  return process.env.GENIXCODE_FORK_DOMAINS_FILE?.trim() || DEFAULT_DOMAINS_FILE
}

/** A parsed allowlist: exact hosts, and suffixes (`.example.com`) for wildcard entries. */
export interface DomainAllowlist {
  readonly hosts: ReadonlySet<string>
  readonly suffixes: readonly string[]
}

function normalize(host: string): string | undefined {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, "")
  if (!trimmed) return undefined
  // Through the URL parser so an internationalised entry compares in the same
  // punycode form that `new URL(...).hostname` produces for the request.
  try {
    return new URL(`http://${trimmed}`).hostname
  } catch {
    return undefined
  }
}

export function parseDomains(text: string): DomainAllowlist {
  const hosts = new Set<string>()
  const suffixes: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim()
    if (!line) continue
    if (line.startsWith("*.")) {
      const host = normalize(line.slice(2))
      if (host) suffixes.push(`.${host}`)
      continue
    }
    const host = normalize(line)
    if (host) hosts.add(host)
  }
  return { hosts, suffixes }
}

const DENY_ALL: DomainAllowlist = { hosts: new Set(), suffixes: [] }

// Every MCP request asks, so the parse is kept until the file's mtime or size
// changes; a stat is the only per-request cost. Editing the file takes effect
// on the next request, without a restart.
let cached: { path: string; mtimeMs: number; size: number; list: DomainAllowlist } | undefined

/** The configured allowlist, or undefined when there is none (everything allowed). */
export function domainAllowlist(): DomainAllowlist | undefined {
  const path = domainsFilePath()
  let stat: fs.Stats
  try {
    stat = fs.statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return DENY_ALL
  }
  if (cached && cached.path === path && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.list
  let list: DomainAllowlist
  try {
    list = parseDomains(fs.readFileSync(path, "utf8"))
  } catch {
    list = DENY_ALL
  }
  cached = { path, mtimeMs: stat.mtimeMs, size: stat.size, list }
  return list
}

export function hostAllowed(hostname: string, list: DomainAllowlist): boolean {
  const host = normalize(hostname.replace(/^\[|\]$/g, "")) ?? hostname.toLowerCase()
  if (isLoopbackHostname(hostname) || isLoopbackHostname(host)) return true
  if (list.hosts.has(host)) return true
  return list.suffixes.some((suffix) => host.endsWith(suffix))
}

/**
 * Why an MCP request to `url` must not be sent, or undefined when it may.
 * Never names the file: like the managed key, where the policy lives is the
 * administrator's business.
 */
export function mcpDomainRefusal(url: string | URL): string | undefined {
  const list = domainAllowlist()
  if (!list) return undefined
  let parsed: URL
  try {
    parsed = typeof url === "string" ? new URL(url) : url
  } catch {
    return "MCP request refused: the URL could not be parsed."
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return `MCP request refused: ${parsed.protocol} is not an HTTP URL.`
  if (hostAllowed(parsed.hostname, list)) return undefined
  return `MCP connections to ${parsed.hostname} are not allowed on this machine.`
}

export class McpDomainRefusedError extends Error {
  override readonly name = "McpDomainRefusedError"
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const MAX_REDIRECTS = 20

/**
 * Wrap a fetch so every request — and every redirect hop it would follow — is
 * checked against the allowlist before it leaves the process.
 *
 * Without an allowlist the wrapper is a straight pass-through. With one, it
 * follows redirects itself (`redirect: "manual"` underneath): left to fetch, an
 * allowed host could answer 307 and have the request, body and all, replayed to
 * a host the list does not name. The hop rules are fetch's own — 303 becomes a
 * GET, 301/302 turn a POST into a GET, 307/308 keep method and body, and a hop
 * to another origin drops `Authorization` so an MCP bearer token never follows a
 * redirect off the server it was issued for. A body that is a one-shot stream
 * cannot be replayed, so that redirect is handed back unfollowed rather than
 * resent empty.
 */
export function allowlistedFetch(base: Fetch): Fetch {
  return async (input, init) => {
    if (!domainAllowlist()) return base(input, init)
    const request = input instanceof Request ? input : undefined
    const mode = init?.redirect ?? request?.redirect ?? "follow"
    let url = new URL(request ? request.url : String(input))
    let method = (init?.method ?? request?.method ?? "GET").toUpperCase()
    let body = init?.body ?? undefined
    let headers = new Headers(init?.headers ?? request?.headers)
    const oneShot = body instanceof ReadableStream || (request?.body != null && init?.body === undefined)

    for (let hop = 0; ; hop++) {
      const refusal = mcpDomainRefusal(url)
      if (refusal) throw new McpDomainRefusedError(refusal)
      const response = await base(hop === 0 ? input : url, { ...init, method, body, headers, redirect: "manual" })
      const location = response.headers.get("location")
      if (response.status < 300 || response.status > 399 || !location || mode === "manual") return response
      if (mode === "error") throw new TypeError(`MCP request to ${url.href} was redirected`)
      if (hop >= MAX_REDIRECTS) throw new McpDomainRefusedError("MCP request refused: too many redirects.")
      const next = new URL(location, url)
      const keep = response.status === 307 || response.status === 308
      if (keep && oneShot) return response
      if (response.status === 303 || (!keep && method === "POST")) {
        if (method !== "HEAD") method = "GET"
        body = undefined
        headers = new Headers(headers)
        for (const name of ["content-type", "content-length", "content-encoding", "content-language", "content-location"])
          headers.delete(name)
      }
      if (next.origin !== url.origin) {
        headers = new Headers(headers)
        headers.delete("authorization")
        headers.delete("proxy-authorization")
        headers.delete("cookie")
      }
      url = next
    }
  }
}
