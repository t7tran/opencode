// fork_change - new file
//
// Secret redaction for the data privacy guard (core/src/fork/privacy.ts).
//
// Users talked the agent into printing the Genix gateway key. The agent could
// see it because nothing stood between a secret and the model: the shell
// inherited every env var, the config directory was pre-approved for reads, and
// tool output went to the provider verbatim. This module is the pure half of
// the fix — it knows what a secret looks like and how to replace one. The
// plugin decides where to apply it.
//
// Three kinds of match, each replaced by a placeholder rather than deleted so
// the model can still reason about the shape of what it was shown:
//
//   literals  exact values the process knows are secret (the managed key, stored
//             credentials, provider apiKeys, secret-named env values), plus the
//             encodings a prompt-injected `base64`/`xxd`/`rev` would turn them
//             into                                                 → <API_KEY>
//   patterns  credential-shaped strings from anywhere: vendor key prefixes,
//             JWTs, PEM private keys, bearer tokens, URL passwords → <SECRET>…
//   hosts     the gateway host and any the administrator lists     → <HOST>
//
// Redaction is lossy by design. A file holding a real secret reads back with a
// placeholder in it, so an agent that rewrites that file wholesale writes the
// placeholder. That is the trade: a secret the model never sees is one it can
// never repeat.
//
// See FORK.md § Data privacy guard.

/**
 * Env/config names that hold secrets. Extends the name test in
 * cli/src/commands/handlers/debug/redact.ts. `auth` skips `author` so git's
 * GIT_AUTHOR_* survives.
 */
export const SECRET_NAME = /(?:api.?key|secret|passw(?:or)?d|token|credential|private.?key|auth(?!or)|cookie|bearer)/i

/**
 * Names that match SECRET_NAME but hold no secret, and that tools break
 * without. SSH_AUTH_SOCK is a socket path; stripping it breaks `git push` over
 * ssh.
 */
export const BENIGN_SECRET_NAMES: ReadonlySet<string> = new Set([
  "SSH_AUTH_SOCK",
  "XAUTHORITY",
  "TOKENIZERS_PARALLELISM",
])

/** Env vars that are always stripped from agent processes, whatever the keep list says. */
const ALWAYS_STRIP = /^(?:GENIXCODE_FORK_|OPENCODE_PASSWORD$|OPENCODE_SERVER_PASSWORD$)/

/** A literal shorter than this is too likely to occur by accident to redact. */
export const MIN_LITERAL_LENGTH = 8

export const PLACEHOLDER = {
  apiKey: "<API_KEY>",
  secret: "<SECRET>",
  privateKey: "<PRIVATE_KEY>",
  jwt: "<JWT>",
  host: "<HOST>",
} as const

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name) && !BENIGN_SECRET_NAMES.has(name)
}

/**
 * A copy of `env` without secret-named variables. `keep` lets an administrator
 * hand a specific token to the agent's shell (a GH_TOKEN for `gh`, say); it
 * cannot bring back the fork's own variables or the server password.
 * `removed` receives each value taken out, so the caller can redact it too.
 */
export function stripSecretEnv(
  env: Record<string, string | undefined>,
  keep: ReadonlySet<string> = new Set(),
  removed?: (value: string) => void,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(env)) {
    const strip = ALWAYS_STRIP.test(name) || (isSecretName(name) && !keep.has(name))
    if (!strip) {
      out[name] = value
      continue
    }
    if (value && removed) removed(value)
  }
  return out
}

/**
 * Whether a value found under a secret-sounding name is worth redacting
 * everywhere. Names over-match (`HF_TOKEN_PATH`, `AUTH_URL`), and a path or URL
 * turned into a literal would black out every mention of it. URL passwords are
 * caught by pattern instead.
 */
export function plausibleSecret(value: string): boolean {
  if (value.length < MIN_LITERAL_LENGTH) return false
  if (/\s/.test(value)) return false
  if (/^[/~.]/.test(value) || /^[A-Za-z]:[\\/]/.test(value) || value.includes("://")) return false
  return /[0-9]/.test(value) || value.length >= 16
}

/** Secret-looking values in an env map, by name. */
export function secretEnvValues(env: Record<string, string | undefined>): string[] {
  const values: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (!value || !plausibleSecret(value)) continue
    if (ALWAYS_STRIP.test(name) || isSecretName(name)) values.push(value)
  }
  return values
}

/**
 * Every plausible secret under a secret-named key in a config-shaped value:
 * provider and model settings, credential metadata. Header values count only
 * under a secret-sounding header name (`Authorization`, `X-Api-Key`), not
 * `Content-Type`.
 */
export function collectSecretValues(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectSecretValues(item, out)
    return out
  }
  if (value === null || typeof value !== "object") return out
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      if (isSecretName(key) && plausibleSecret(item)) out.push(item)
      continue
    }
    collectSecretValues(item, out)
  }
  return out
}

/** Credential-shaped strings, wherever they turn up. Order matters: specific before generic. */
const BUILTIN_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, PLACEHOLDER.privateKey],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, PLACEHOLDER.jwt],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, PLACEHOLDER.apiKey],
  [/\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}/g, PLACEHOLDER.apiKey],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, PLACEHOLDER.apiKey],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, PLACEHOLDER.apiKey],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, PLACEHOLDER.apiKey],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, PLACEHOLDER.apiKey],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, PLACEHOLDER.apiKey],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, PLACEHOLDER.apiKey],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, PLACEHOLDER.apiKey],
]

// `Bearer <token>` / `Basic <token>`: keep the scheme so the line still reads.
const AUTH_SCHEME = /\b(Bearer|Basic|Token)(\s+)([A-Za-z0-9._~+/-]{16,}=*)/gi
// `scheme://user:password@host`: only the password goes.
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)@/gi

// A value under a secret name, in the two shapes that are unambiguous enough to
// act on without mangling code: an env-style `NAME=value` line, and a quoted
// literal after a key (`"apiKey": "…"`, `password: '…'`). An unquoted value in
// code (`apiKey: process.env.X`) is left alone — rewriting it would corrupt
// the source the agent is reading.
const ENV_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(["']?)([^\s"'#]+)\4/gm
const QUOTED_PAIR = /(["']?)([A-Za-z_][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(["'])([^"'\n]+)\4/g

/** Placeholders and template references are not secrets. */
function looksSecret(value: string): boolean {
  if (value.length < MIN_LITERAL_LENGTH) return false
  if (/^[<$%{]/.test(value)) return false
  if (value === "***" || /^\*+$/.test(value)) return false
  if (/\s/.test(value)) return false
  return /[0-9]/.test(value) || value.length >= 20
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The forms a literal takes after the encodings a shell can apply to it. */
function literalForms(value: string): string[] {
  const forms = new Set<string>([value])
  const bytes = Buffer.from(value, "utf8")
  const base64 = bytes.toString("base64")
  forms.add(base64.replace(/=+$/, ""))
  forms.add(bytes.toString("base64url"))
  // `echo key | base64` appends a newline, which only changes the tail. The
  // first floor(n/3)*4 characters are fixed whatever follows the key.
  const stable = base64.slice(0, Math.floor(bytes.length / 3) * 4)
  if (stable.length >= 12) forms.add(stable)
  const hex = bytes.toString("hex")
  forms.add(hex)
  forms.add(hex.toUpperCase())
  forms.add(encodeURIComponent(value))
  forms.add([...value].reverse().join(""))
  return [...forms].filter((form) => form.length >= MIN_LITERAL_LENGTH)
}

/** A hostname, or a URL's hostname. */
function hostOf(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      return new URL(trimmed).hostname || undefined
    } catch {
      return undefined
    }
  }
  return trimmed.replace(/\.$/, "")
}

export interface RedactorInput {
  /** Exact secret values. Shorter than MIN_LITERAL_LENGTH are ignored. */
  readonly literals?: Iterable<string>
  /** Hostnames (or URLs) to hide. `*.example.com` hides every subdomain. */
  readonly hosts?: Iterable<string>
  /** Extra patterns, replaced by <SECRET>. Must be global (`g`) regexps. */
  readonly patterns?: Iterable<RegExp>
}

export type Redactor = (text: string) => string

/** A redactor for one secret set. Building one is the expensive part; reuse it. */
export function buildRedactor(input: RedactorInput = {}): Redactor {
  const forms = new Set<string>()
  for (const literal of input.literals ?? []) {
    const value = literal.trim()
    if (value.length < MIN_LITERAL_LENGTH) continue
    for (const form of literalForms(value)) forms.add(form)
  }
  // Longest first, so a key that contains another redacts whole.
  const literals =
    forms.size === 0
      ? undefined
      : new RegExp(
          [...forms]
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp)
            .join("|"),
          "g",
        )

  const hostSources: string[] = []
  for (const raw of input.hosts ?? []) {
    const wildcard = raw.trim().startsWith("*.")
    const host = hostOf(wildcard ? raw.trim().slice(2) : raw)
    if (!host) continue
    hostSources.push(wildcard ? `(?:[a-z0-9-]+\\.)+${escapeRegExp(host)}` : escapeRegExp(host))
  }
  const hosts =
    hostSources.length === 0 ? undefined : new RegExp(`(?<![a-z0-9.-])(?:${hostSources.join("|")})(?![a-z0-9-])`, "gi")

  const extra = [...(input.patterns ?? [])].map((pattern) =>
    pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + "g"),
  )

  return (text: string) => {
    if (!text) return text
    let out = text
    if (literals) out = out.replace(literals, PLACEHOLDER.apiKey)
    for (const [pattern, placeholder] of BUILTIN_PATTERNS) out = out.replace(pattern, placeholder)
    for (const pattern of extra) out = out.replace(pattern, PLACEHOLDER.secret)
    out = out.replace(AUTH_SCHEME, (match, scheme: string, space: string, token: string) =>
      token.startsWith("<") ? match : `${scheme}${space}${PLACEHOLDER.secret}`,
    )
    out = out.replace(URL_PASSWORD, (match, prefix: string, password: string) =>
      password.startsWith("<") ? match : `${prefix}${PLACEHOLDER.secret}@`,
    )
    out = out.replace(ENV_LINE, (match, lead: string, name: string, eq: string, quote: string, value: string) =>
      isSecretName(name) && looksSecret(value) ? `${lead}${name}${eq}${quote}${PLACEHOLDER.secret}${quote}` : match,
    )
    out = out.replace(QUOTED_PAIR, (match, q1: string, name: string, sep: string, q2: string, value: string) =>
      isSecretName(name) && looksSecret(value) ? `${q1}${name}${q1}${sep}${q2}${PLACEHOLDER.secret}${q2}` : match,
    )
    if (hosts) out = out.replace(hosts, PLACEHOLDER.host)
    return out
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * `value` with every string leaf passed through `redact`. Only arrays and plain
 * objects are walked: class instances (media assets, schema classes) are kept
 * as they are. Returns the same reference when nothing changed, so callers can
 * skip rebuilding what they did not touch.
 */
export function redactDeep<T>(value: T, redact: Redactor, skipKeys: ReadonlySet<string> = new Set()): T {
  if (typeof value === "string") return redact(value) as T
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const out = redactDeep(item, redact, skipKeys)
      if (out !== item) changed = true
      return out
    })
    return (changed ? next : value) as T
  }
  if (!isPlainObject(value)) return value
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const out = skipKeys.has(key) ? item : redactDeep(item, redact, skipKeys)
    if (out !== item) changed = true
    next[key] = out
  }
  return (changed ? next : value) as T
}
