import { EOL } from "node:os"
import { isConflictError, type CredentialCreateInput } from "@opencode/client"
import { Credential } from "@opencode/schema/credential"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, request } from "./shared"
import { errorMessage } from "../../../util/error"
import { readStdin } from "../../../util/io"
import { credentialRefusal } from "@opencode/util/fork/guard" // fork_change - provider lock

export default Runtime.handler(
  Commands.commands.auth.commands.import,
  Effect.fn("cli.auth.import")(
    function* (input) {
      const file = Option.getOrUndefined(input.file)
      if (!file && process.stdin.isTTY)
        return yield* Effect.fail(new Error("Pipe auth export output into stdin or pass a file to import"))
      const text = yield* request(() => (file ? Bun.file(file).text() : readStdin()))
      const credentials = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Credential.Entry)))(text)
      const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
      const existing = yield* request((signal) => client.credential.list({ signal }))
      const ids = new Set(existing.map((credential) => credential.id))
      const integrations = new Set(existing.map((credential) => credential.integrationID))
      // fork_change start - the server refuses what the provider lock refuses, and one
      // refusal would abort the whole import; skip those and say so instead
      const refused = credentials.filter((credential) => credentialRefusal(credential.integrationID) !== undefined)
      if (refused.length)
        process.stderr.write(
          `Skipped ${refused.length} ${refused.length === 1 ? "credential" : "credentials"} this build does not accept` + EOL,
        )
      const accepted = credentials.filter((credential) => !refused.includes(credential))
      // fork_change end
      const results = yield* Effect.forEach(accepted /* fork_change */, (credential) => {
        if (ids.has(credential.id)) return Effect.succeed(false)
        return request((signal) =>
          client.credential.create(
            {
              id: credential.id,
              integrationID: credential.integrationID,
              label: credential.label,
              // Stored metadata is JSON, but the credential schema types it as unknown while the generated client expects JSON.
              value: credential.value as CredentialCreateInput["value"],
              // Keep the destination's current selections; only integrations new to it adopt the exported selection.
              activate: credential.active && !integrations.has(credential.integrationID),
            },
            { signal },
          ),
        ).pipe(
          Effect.as(true),
          Effect.catchIf(isConflictError, () => Effect.succeed(false)),
        )
      })
      const imported = results.filter(Boolean).length
      process.stderr.write(
        `Imported ${imported} ${imported === 1 ? "credential" : "credentials"}` +
          (results.length > imported ? `, skipped ${results.length - imported} already present` : "") +
          EOL,
      )
    },
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
