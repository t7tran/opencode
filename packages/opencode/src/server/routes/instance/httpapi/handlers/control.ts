import { Auth } from "@/auth"

// fork_change start
import { isLockedProvider, lockedProviderManaged } from "@opencode-ai/core/fork/lock"
// fork_change end
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpApiError } from "effect/unstable/httpapi" // fork_change
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: Auth.Info
    }) {
      // fork_change start
      if (!isLockedProvider(ctx.params.providerID)) {
        yield* Effect.logWarning("fork: rejected auth.set for non-locked provider", {
          providerID: ctx.params.providerID,
        })
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      // The managed key file owns the credential: the user cannot supply another key.
      if (lockedProviderManaged()) {
        yield* Effect.logWarning("fork: rejected auth.set: API key is embedded")
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      // fork_change end
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      // fork_change start
      if (!isLockedProvider(ctx.params.providerID)) {
        yield* Effect.logWarning("fork: rejected auth.remove for non-locked provider", {
          providerID: ctx.params.providerID,
        })
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      // The managed key file owns the credential: the provider cannot be disconnected.
      if (lockedProviderManaged()) {
        yield* Effect.logWarning("fork: rejected auth.remove: API key is embedded")
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      // fork_change end
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
