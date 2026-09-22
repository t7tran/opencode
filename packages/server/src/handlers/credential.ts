import { Credential } from "@opencode/core/credential"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "@opencode/protocol/errors" // fork_change - provider lock
import { managedCredentialRefusal } from "@opencode/util/fork/guard" // fork_change - provider lock

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.activate",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.activate(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        // fork_change start - the managed key file owns the credential, so the
        // provider cannot be disconnected. Refused here rather than only in the
        // UI, so a direct API or CLI call cannot bypass it.
        const refusal = managedCredentialRefusal()
        if (refusal) {
          yield* Effect.logWarning("fork: rejected credential.remove: API key is embedded")
          return yield* new InvalidRequestError({ message: refusal, kind: "integration_authorization" })
        }
        // fork_change end
        yield* credential.remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
