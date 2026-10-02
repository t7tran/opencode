import { Credential } from "@opencode/core/credential"
import { ConflictError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "@opencode/protocol/errors" // fork_change - provider lock
import { credentialRefusal, managedCredentialRefusal } from "@opencode/util/fork/guard" // fork_change - provider lock

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.list",
      Effect.fn(function* () {
        const credential = yield* Credential.Service
        return { data: entries(yield* credential.all()) }
      }),
    )
    .handle(
      "credential.create",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        // fork_change start - credential.create is integration.connect.key without
        // the connect handler's checks, and `auth import` goes through it. A stored
        // credential for a pruned integration still activates it, so it is refused
        // on the same terms as a connect.
        const refusal = credentialRefusal(ctx.payload.integrationID)
        if (refusal) {
          yield* Effect.logWarning("fork: rejected credential.create", { integrationID: ctx.payload.integrationID })
          return yield* new InvalidRequestError({ message: refusal, kind: "integration_authorization" })
        }
        // fork_change end
        if (ctx.payload.id && (yield* credential.get(ctx.payload.id)))
          return yield* new ConflictError({
            resource: ctx.payload.id,
            message: `Credential already exists: ${ctx.payload.id}`,
          })
        const created = yield* credential.create(ctx.payload)
        const entry = entries(yield* credential.list(created.integrationID)).find((item) => item.id === created.id)
        return { data: entry ?? { ...created, active: false } }
      }),
    )
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
        // fork_change start - switching accounts is a credential mutation like any
        // other; refused while the key is managed, on the same terms as remove.
        const refusal = managedCredentialRefusal()
        if (refusal) {
          yield* Effect.logWarning("fork: rejected credential.activate: API key is embedded")
          return yield* new InvalidRequestError({ message: refusal, kind: "integration_authorization" })
        }
        // fork_change end
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

// Credential listings order each integration's selected credential last.
function entries(credentials: Credential.Info[]) {
  const selected = new Map(credentials.map((item) => [item.integrationID, item.id]))
  return credentials.map((item) => ({
    id: item.id,
    integrationID: item.integrationID,
    label: item.label,
    active: selected.get(item.integrationID) === item.id,
    value: item.value,
  }))
}
