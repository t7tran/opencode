// fork_change - new file
//
// `genixcode-cli key seal` — turn a plain API key into the single-line blob the
// managed key file accepts. See util/src/fork/key-seal.ts and FORK.md.
//
// There is deliberately no `key unseal`: printing the plain key back out is
// exactly what sealing is meant to stop being a one-liner.

import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { isSealed, seal, sealingAvailable } from "@opencode/util/fork/key-seal"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

const readStdin = () =>
  process.stdin.isTTY
    ? Promise.resolve("")
    : new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
        process.stdin.on("error", reject)
      })

export default Runtime.handler(
  Commands.commands.key.commands.seal,
  Effect.fn("cli.key.seal")(function* (input) {
    // stdin keeps the key out of the shell history and out of the process list.
    const piped = Option.isSome(input.key) ? undefined : yield* Effect.promise(readStdin)
    const plain = (Option.getOrUndefined(input.key) ?? piped ?? "").trim()
    // A plain message and a non-zero exit, no stack: terraform's external data
    // source shows stderr to whoever ran the plan.
    const refuse = (message: string) => {
      process.stderr.write(message + EOL)
      process.exitCode = 1
    }
    if (plain.length === 0) return refuse("no key given: pass it as an argument or pipe it on stdin")
    if (isSealed(plain)) return refuse("that key is already sealed")
    // Only an unbuilt run with no pepper file gets here: a build without one
    // fails, so a released binary always has it compiled in. See FORK.md.
    if (!sealingAvailable())
      return refuse("no key-sealing pepper: this run cannot seal — use a released build, or see FORK.md")
    // Bare blob on stdout, nothing else, so `$(genixcode-cli key seal ...)` and
    // pipes into a provisioning tool work without post-processing.
    process.stdout.write(seal(plain) + "\n")
  }),
)
