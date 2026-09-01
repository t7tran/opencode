// fork_change - new file
//
// `genixcode key` — provisioning helpers for the managed API key file
// (/etc/kilo.key). See src/fork/key-file.ts, src/fork/key-seal.ts, and FORK.md.
//
// There is deliberately no `key unseal`: printing the plain key back out is
// exactly what sealing is meant to stop being a one-liner. `key status` reports
// a fingerprint instead, which is enough to confirm which key a host holds.

import type { Argv } from "yargs"
import fs from "node:fs"
import { Effect } from "effect"
import { keyFilePath } from "@opencode-ai/core/fork/key-file"
import { isSealed, keyFingerprint, seal, unseal } from "@opencode-ai/core/fork/key-seal"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

const SealCommand = effectCmd({
  command: "seal [key]",
  describe: "seal an API key into the single-line blob accepted by the key file",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("key", {
      describe: "the plain API key; read from stdin when omitted",
      type: "string",
    }),
  handler: Effect.fn("Cli.key.seal")(function* (args) {
    // stdin keeps the key out of the shell history and out of the process list.
    const piped = args.key
      ? undefined
      : yield* Effect.promise(() => (process.stdin.isTTY ? Promise.resolve("") : Bun.stdin.text()))
    const plain = (args.key ?? piped ?? "").trim()
    if (plain.length === 0) return yield* fail("no key given: pass it as an argument or pipe it on stdin")
    if (isSealed(plain)) return yield* fail("that key is already sealed")
    // Bare blob on stdout, nothing else, so `$(genixcode key seal ...)` and
    // pipes into a provisioning tool work without post-processing.
    process.stdout.write(seal(plain) + "\n")
  }),
})

const StatusCommand = effectCmd({
  command: "status",
  describe: "report whether a managed key is provisioned, and in which form",
  instance: false,
  handler: Effect.fn("Cli.key.status")(function* () {
    const path = keyFilePath()
    const raw = yield* Effect.sync(() => {
      try {
        return fs.readFileSync(path, "utf8").trim()
      } catch {
        return undefined
      }
    })

    const line = (label: string, value: string) => UI.println(`${label.padEnd(13)}${value}`)
    line("path", path)

    if (raw === undefined) {
      line("state", "absent or unreadable — the normal interactive login flow applies")
      return
    }
    if (raw.length === 0) {
      line("state", "blank — treated the same as absent")
      return
    }
    if (!isSealed(raw)) {
      line("state", "plain")
      line("fingerprint", keyFingerprint(raw))
      return
    }
    const plain = unseal(raw)
    if (plain === undefined) {
      // Almost always a blob sealed by a build with a different pepper, so the
      // provider falls back to interactive login rather than failing at the gateway.
      line("state", "sealed, but this build cannot unseal it — the key is not in use")
      return
    }
    line("state", "sealed")
    line("fingerprint", keyFingerprint(plain))
  }),
})

export const KeyCommand = effectCmd({
  command: "key",
  describe: "managed API key file tools",
  instance: false,
  builder: (yargs: Argv) => yargs.command(SealCommand).command(StatusCommand).demandCommand(),
  handler: Effect.fn("Cli.key")(function* () {}),
})
