import { Model } from "@opencode/core/model"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { redactManagedKey } from "@opencode/util/fork/guard" // fork_change - provider lock

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "model.list",
        Effect.fn(function* () {
          const models = yield* Model.Service
          // fork_change start - every model's settings carry its provider's, managed key included
          return yield* response(models.available().pipe(Effect.map((list) => list.map(redactManagedKey))))
          // fork_change end
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          const models = yield* Model.Service
          return yield* response(models.default().pipe(Effect.map((model) => model && redactManagedKey(model)))) // fork_change - provider lock
        }),
      )
  }),
)
