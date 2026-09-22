// fork_change - new file
//
// `genixcode key seal` — turn a plain API key into the single-line blob the
// managed key file accepts. See core/src/fork/key-seal.ts and FORK.md.
//
// There is deliberately no `key unseal`: printing the plain key back out is
// exactly what sealing is meant to stop being a one-liner.

import { Effect, Option } from "effect"
import { isSealed, seal } from "@opencode/util/fork/key-seal"
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
    if (plain.length === 0) {
      process.stderr.write("no key given: pass it as an argument or pipe it on stdin\n")
      return yield* Effect.fail(new Error("no key given"))
    }
    if (isSealed(plain)) {
      process.stderr.write("that key is already sealed\n")
      return yield* Effect.fail(new Error("already sealed"))
    }
    // Bare blob on stdout, nothing else, so `$(genixcode key seal ...)` and
    // pipes into a provisioning tool work without post-processing.
    process.stdout.write(seal(plain) + "\n")
  }),
)
