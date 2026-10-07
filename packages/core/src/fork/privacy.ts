// fork_change - new file
//
// The data privacy guard, as a v2 plugin.
//
// Users talked the agent into printing the Genix gateway key. Asking nicely in
// a system prompt cannot stop that — a model can be argued out of any rule — so
// this plugin makes sure the model never holds a secret to give away:
//
//   1. Shell env strip (`shell` create.before). The agent's shell, and a user's
//      `!` command whose output the model reads, no longer inherit secret-named
//      env vars. `printenv` has nothing to show.
//   2. Read denial (`permission` evaluate). The credential DB, the service
//      config holding the server password, the global genixcode.json, the key
//      file and the privacy file are refused, to the read tool and to shell
//      commands that name them. This hook has the final say, so neither an
//      agent's own rules nor a session "always allow" can reopen them.
//   3. Tool output redaction (`tool` execute.after). Runs before the result is
//      stored, so a secret a tool turned up never reaches the database, the UI
//      or the model.
//   4. Request redaction (`session` context and friends). A last pass over the
//      whole request: secrets a user pasted, history written before this guard
//      existed, anything the passes above missed.
//   5. Organisation instructions. /etc/genixcode.instructions.md, appended as the
//      last system part, for the rules an organisation wants on every session.
//
// Layers 1–4 are on whenever /etc/genixcode.privacy exists, lock or no lock;
// an empty file turns them on with built-in redaction only. With no file they
// are a no-op, so an unprovisioned host behaves as upstream does. Layer 5
// depends only on its own file. The plugin is registered after ForkLockPlugin
// and guarded, so config cannot remove it.
//
// What it cannot do: FORK.md § Sealed key files explains why anyone who can run
// the client can recover the managed key without the agent's help. This closes
// the "ask the agent" route, not that one.
//
// See FORK.md § Data privacy guard.

import fs from "node:fs"
import path from "node:path"
import { Message, SystemPart, type ContentPart } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionRequest } from "@opencode/plugin/effect/session"
import { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { CONFIG_FILENAMES } from "@opencode/util/fork/brand"
import { keyFilePath, managedKey } from "@opencode/util/fork/key-file"
import { lockedProvider } from "@opencode/util/fork/lock"
import { DEFAULT_INSTRUCTIONS_FILE, orgInstructions, renderOrgInstructions } from "@opencode/util/fork/org-instructions"
import { DEFAULT_PRIVACY_FILE, privacyPolicy } from "@opencode/util/fork/privacy-file"
import {
  buildRedactor,
  collectSecretValues,
  plausibleSecret,
  redactDeep,
  secretEnvValues,
  stripSecretEnv,
  type Redactor,
} from "@opencode/util/fork/redact"
import { Effect } from "effect"
import { Credential } from "../credential.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { Wildcard } from "../util/wildcard.js"

export interface PrivacyFiles {
  readonly instructions: string
  readonly privacy: string
}

const DEFAULT_FILES: PrivacyFiles = { instructions: DEFAULT_INSTRUCTIONS_FILE, privacy: DEFAULT_PRIVACY_FILE }

// The secret set is gathered from services and files, so it is rebuilt at most
// this often rather than per tool call. A value the env strip removes
// invalidates it at once.
const REBUILD_MS = 5_000

// Tool content keys that are references, not text: a file URI or a MIME type
// never holds a secret, and rewriting a `data:` URI would corrupt it.
const SKIP_KEYS: ReadonlySet<string> = new Set(["uri", "mime"])

const READ_REFUSAL = "This file holds credentials and is not readable by the agent."
const SHELL_REFUSAL = "This command names a file that holds credentials, which the agent may not access."

const slash = (value: string) => value.replaceAll("\\", "/")

/** Files whose contents are credentials, as permission resource globs. */
export function sensitivePaths(input: { config: string; data: string; privacy: string }): string[] {
  return [
    ...CONFIG_FILENAMES.map((name) => path.join(input.config, name)),
    path.join(input.config, "service*.json"),
    path.join(input.data, "opencode.db*"),
    path.join(input.data, "auth.json"),
    keyFilePath(),
    input.privacy,
  ].map(slash)
}

/**
 * Substrings that mark a shell command as touching a sensitive file: each path
 * as written, with the home directory spelt `~`, `$HOME` and `${HOME}`, plus
 * the names distinctive enough to catch on their own. A heuristic — a command
 * can build a path the scanner never sees — which is why redaction backs it.
 */
export function sensitiveCommandMarkers(paths: readonly string[], home: string): string[] {
  const markers = new Set<string>(["kilo.key", "genixcode.privacy", "opencode.db"])
  const root = slash(home).replace(/\/$/, "")
  for (const item of paths) {
    const literal = item.replace(/\*.*$/, "")
    if (literal.length < 4) continue
    markers.add(literal)
    if (root && literal.startsWith(root + "/")) {
      const rest = literal.slice(root.length)
      for (const alias of ["~", "$HOME", "${HOME}"]) markers.add(alias + rest)
    }
  }
  return [...markers]
}

function redactPart(part: ContentPart, redact: Redactor): ContentPart {
  switch (part.type) {
    case "text": {
      const text = redact(part.text)
      return text === part.text ? part : { ...part, text }
    }
    case "tool-call": {
      const input = redactDeep(part.input, redact, SKIP_KEYS)
      return input === part.input ? part : { ...part, input }
    }
    case "tool-result": {
      const result = redactDeep(part.result, redact, SKIP_KEYS)
      return result === part.result ? part : { ...part, result }
    }
    // Reasoning and compaction parts can carry provider signatures over their
    // text; editing them gets the request rejected. They are the model's own
    // words about input that was already redacted.
    default:
      return part
  }
}

/** A message with every text-bearing part redacted; the same instance when nothing changed. */
export function redactMessage(message: Message, redact: Redactor): Message {
  let changed = false
  const content = message.content.map((part) => {
    const next = redactPart(part, redact)
    if (next !== part) changed = true
    return next
  })
  return changed ? new Message({ ...message, content }) : message
}

export const makeForkPrivacyPlugin = (files: PrivacyFiles = DEFAULT_FILES) =>
  define({
    id: "fork.privacy",
    effect: Effect.fn(function* (ctx) {
      const global = yield* Global.Service
      const credentials = yield* Credential.Service
      const providers = yield* Provider.Service
      const models = yield* Model.Service

      // Values the env strip has taken out of a shell. The session's forwarded
      // env is only visible there, so this is how its secrets join the set.
      const stripped = new Set<string>()
      let cached: { at: number; redact: Redactor } | undefined
      let warned = { privacy: false, instructions: false }

      const policy = () => {
        const current = privacyPolicy(files.privacy)
        if (current.unreadable && !warned.privacy) {
          warned = { ...warned, privacy: true }
          return Effect.as(Effect.logWarning("fork: privacy file is unreadable; using built-in redaction only"), current)
        }
        if (current.errors.length > 0 && !warned.privacy) {
          warned = { ...warned, privacy: true }
          return Effect.as(Effect.logWarning("fork: privacy file has errors", { errors: current.errors }), current)
        }
        return Effect.succeed(current)
      }

      // No privacy file, no guard. Checked per call (a stat, cached parse), so
      // provisioning or removing the file takes effect on the next one.
      const off = () => privacyPolicy(files.privacy).absent

      const build = Effect.gen(function* () {
        const current = yield* policy()
        const literals = new Set<string>([...stripped, ...current.secrets, ...secretEnvValues(process.env)])
        const key = managedKey()
        if (key) literals.add(key)
        // A sealed key file holds a blob, not the key; the blob is a credential too.
        try {
          const raw = fs.readFileSync(keyFilePath(), "utf8").trim()
          if (raw) literals.add(raw)
        } catch {}
        for (const provider of yield* providers.all()) collectSecretValues(provider.settings).forEach((v) => literals.add(v))
        for (const model of yield* models.all()) {
          collectSecretValues(model.settings).forEach((v) => literals.add(v))
          for (const variant of model.variants) collectSecretValues(variant.settings).forEach((v) => literals.add(v))
        }
        for (const credential of yield* credentials.all()) {
          const value = credential.value
          if (value.type === "key") literals.add(value.key)
          else {
            literals.add(value.access)
            literals.add(value.refresh)
          }
          collectSecretValues(value.metadata).forEach((v) => literals.add(v))
        }
        return buildRedactor({
          literals,
          hosts: [lockedProvider().baseURL, ...current.hosts],
          patterns: current.patterns,
        })
      })

      // Never fails: a redactor that could not gather the secret set still
      // applies the built-in patterns rather than letting text through raw.
      const redactor = Effect.gen(function* () {
        const now = Date.now()
        if (cached && now - cached.at < REBUILD_MS) return cached.redact
        const redact = yield* build.pipe(
          Effect.catchCause((cause) =>
            Effect.as(
              Effect.logWarning("fork: could not gather the secret set; redacting patterns only", { cause }),
              buildRedactor({ hosts: [lockedProvider().baseURL] }),
            ),
          ),
        )
        cached = { at: now, redact }
        return redact
      })

      // 1. Shell env strip.
      yield* ctx.shell.hook("create.before", (invocation) =>
        Effect.gen(function* () {
          if (off()) return
          const current = yield* policy()
          const before = stripped.size
          invocation.env = stripSecretEnv(invocation.env, current.unreadable ? new Set() : current.keepEnv, (value) => {
            if (plausibleSecret(value)) stripped.add(value)
          })
          if (stripped.size !== before) cached = undefined
        }),
      )

      // 2. Read denial.
      const sensitive = sensitivePaths({ config: global.config, data: global.data, privacy: files.privacy })
      const markers = sensitiveCommandMarkers(sensitive, global.home)
      yield* ctx.permission.hook("evaluate", (event) =>
        Effect.sync(() => {
          if (event.effect === "deny" || off()) return
          if (event.action === "read") {
            if (!event.resources.some((resource) => sensitive.some((glob) => Wildcard.match(resource, glob)))) return
            event.effect = "deny"
            event.message = READ_REFUSAL
            return
          }
          if (event.action === "shell") {
            if (!event.resources.some((resource) => markers.some((marker) => slash(resource).includes(marker)))) return
            event.effect = "deny"
            event.message = SHELL_REFUSAL
          }
        }),
      )

      // 3. Tool output redaction, before the result is stored.
      yield* ctx.tool.hook("execute.after", (event) =>
        Effect.gen(function* () {
          if (off()) return
          const redact = yield* redactor
          if (event.status === "error") {
            const message = redact(event.error.message)
            const metadata = redactDeep(event.error.metadata, redact)
            if (message === event.error.message && metadata === event.error.metadata) return
            event.error = new Tool.Error({
              message,
              ...(event.error.error === undefined ? {} : { error: event.error.error }),
              ...(metadata === undefined ? {} : { metadata }),
            })
            return
          }
          const result = event.result
          const output = redactDeep(result.output, redact, SKIP_KEYS)
          const content =
            typeof result.content === "string" ? redact(result.content) : redactDeep(result.content, redact, SKIP_KEYS)
          const metadata = redactDeep(result.metadata, redact, SKIP_KEYS)
          if (output === result.output && content === result.content && metadata === result.metadata) return
          event.result = {
            ...(output === undefined ? {} : { output }),
            ...(content === undefined ? {} : { content }),
            ...(metadata === undefined ? {} : { metadata }),
          }
        }),
      )

      // 4 + 5. Request redaction and organisation instructions. Redaction is
      // deterministic, so the same history redacts to the same bytes and the
      // provider's prompt cache still hits.
      const request = (event: SessionRequest) =>
        Effect.gen(function* () {
          if (!off()) {
            const redact = yield* redactor
            for (let i = 0; i < event.system.length; i++) {
              const part = event.system[i]!
              const text = redact(part.text)
              if (text !== part.text) event.system[i] = { ...part, text }
            }
            for (let i = 0; i < event.messages.length; i++) {
              const message = event.messages[i]!
              const next = redactMessage(message, redact)
              if (next !== message) event.messages[i] = next
            }
          }
          const instructions = orgInstructions(files.instructions)
          if (instructions.status === "unreadable" && !warned.instructions) {
            warned = { ...warned, instructions: true }
            yield* Effect.logWarning("fork: organisation instructions file is unreadable")
          }
          if (instructions.status === "present") event.system.push(SystemPart.make(renderOrgInstructions(instructions.text)))
        })
      yield* ctx.session.hook("context", request)
      yield* ctx.session.hook("compaction", request)
      yield* ctx.session.hook("generate", request)
      yield* ctx.session.hook("title", request)
    }),
  })

export const ForkPrivacyPlugin = makeForkPrivacyPlugin()
