// fork_change - new file
//
// `genixcode key status` — report what a host currently has provisioned, plus a
// short fingerprint of the key, so you can confirm a host holds the key you
// provisioned without either side printing it. See FORK.md.

import fs from "node:fs"
import { EOL } from "node:os"
import { Effect } from "effect"
import { keyFilePath } from "@opencode/util/fork/key-file"
import { isSealed, keyFingerprint, unseal } from "@opencode/util/fork/key-seal"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.key.commands.status,
  Effect.fn("cli.key.status")(function* () {
    const path = keyFilePath()
    const raw = yield* Effect.sync(() => {
      try {
        return fs.readFileSync(path, "utf8").trim()
      } catch {
        return undefined
      }
    })

    const line = (label: string, value: string) => process.stdout.write(`${label.padEnd(13)}${value}${EOL}`)
    line("path", path)

    if (raw === undefined) return line("state", "absent or unreadable — the normal interactive login flow applies")
    if (raw.length === 0) return line("state", "blank — treated the same as absent")
    if (!isSealed(raw)) {
      line("state", "plain")
      return line("fingerprint", keyFingerprint(raw))
    }
    const plain = unseal(raw)
    // Almost always a blob sealed by a build with a different pepper, so the
    // provider falls back to interactive login rather than failing at the gateway.
    if (plain === undefined) return line("state", "sealed, but this build cannot unseal it — the key is not in use")
    line("state", "sealed")
    line("fingerprint", keyFingerprint(plain))
  }),
)
