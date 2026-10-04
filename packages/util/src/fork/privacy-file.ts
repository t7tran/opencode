// fork_change - new file
//
// The administrator's half of the data privacy guard: extra redaction rules and
// env-var exceptions, from a root-owned file.
//
//   /etc/genixcode.privacy
//
//   # full-line comments and blank lines are ignored
//   secret   <literal value>         redacted wherever it appears      → <API_KEY>
//   pattern  /<regex>/<flags>        redacted wherever it matches      → <SECRET>
//   host     internal.example.com    redacted wherever it appears      → <HOST>
//   host     *.corp.example.com      any subdomain of corp.example.com
//   keep-env GH_TOKEN                survives the agent shell's env strip
//
// No file means built-in redaction only, with no exceptions. A file that exists
// but cannot be read fails closed: built-in redaction still runs, and no
// `keep-env` is granted — an administrator who wrote one meant to restrict, and
// a permissions mistake should not lift that. The same rule as mcp-domains.ts.
//
// Unlike the key file and the domains file, there is no env var to move the
// path. Those overrides only ever hurt the person who sets them; this one would
// let a user point the guard at an empty file. Tests pass a path instead.
//
// See FORK.md § Data privacy guard.

import fs from "node:fs"

export const DEFAULT_PRIVACY_FILE = "/etc/genixcode.privacy"

export interface PrivacyPolicy {
  readonly secrets: readonly string[]
  readonly patterns: readonly RegExp[]
  readonly hosts: readonly string[]
  readonly keepEnv: ReadonlySet<string>
  /** Lines that could not be parsed, as `line N: reason`. */
  readonly errors: readonly string[]
  /** The file exists but could not be read; everything above is empty. */
  readonly unreadable: boolean
}

const EMPTY: PrivacyPolicy = { secrets: [], patterns: [], hosts: [], keepEnv: new Set(), errors: [], unreadable: false }
const UNREADABLE: PrivacyPolicy = { ...EMPTY, unreadable: true }

export function parsePrivacy(text: string): PrivacyPolicy {
  const secrets: string[] = []
  const patterns: RegExp[] = []
  const hosts: string[] = []
  const keepEnv = new Set<string>()
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith("#")) return
    const match = /^(\S+)\s+(.*)$/.exec(line)
    const keyword = match?.[1]?.toLowerCase()
    // A secret may contain `#`, so only the other keywords take trailing comments.
    const value = keyword === "secret" ? match?.[2]?.trim() : match?.[2]?.replace(/\s+#.*$/, "").trim()
    if (!keyword || !value) {
      errors.push(`line ${index + 1}: expected "<keyword> <value>"`)
      return
    }
    switch (keyword) {
      case "secret":
        secrets.push(value)
        return
      case "host":
        hosts.push(value)
        return
      case "keep-env":
        keepEnv.add(value)
        return
      case "pattern": {
        const literal = /^\/(.+)\/([a-z]*)$/.exec(value)
        if (!literal) {
          errors.push(`line ${index + 1}: pattern must be written /regex/flags`)
          return
        }
        try {
          const flags = literal[2]!.includes("g") ? literal[2]! : literal[2]! + "g"
          patterns.push(new RegExp(literal[1]!, flags))
        } catch (error) {
          errors.push(`line ${index + 1}: ${(error as Error).message}`)
        }
        return
      }
      default:
        errors.push(`line ${index + 1}: unknown keyword "${keyword}"`)
    }
  })
  return { secrets, patterns, hosts, keepEnv, errors, unreadable: false }
}

// Asked on every tool call and every model request, so the parse is kept until
// the file's mtime or size changes; a stat is the only per-call cost.
const cache = new Map<string, { mtimeMs: number; size: number; policy: PrivacyPolicy }>()

/** The administrator's privacy policy, or an empty one when there is no file. */
export function privacyPolicy(path: string = DEFAULT_PRIVACY_FILE): PrivacyPolicy {
  let stat: fs.Stats
  try {
    stat = fs.statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY
    return UNREADABLE
  }
  const cached = cache.get(path)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.policy
  let policy: PrivacyPolicy
  try {
    policy = parsePrivacy(fs.readFileSync(path, "utf8"))
  } catch {
    policy = UNREADABLE
  }
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, policy })
  return policy
}
