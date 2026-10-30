import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerProcess } from "../../server-process"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fnUntraced(function* (input) {
    if (input.service && input.stdio) return yield* Effect.fail(new Error("--service and --stdio cannot be combined"))
    // fork_change start - a lone `--allow-remote-no-auth` changes nothing, and
    // silently accepting it would read as if it had opened the server up.
    if (input.allowRemoteNoAuth && input.auth)
      return yield* Effect.fail(new Error("--allow-remote-no-auth only applies together with --no-auth"))
    // fork_change end
    return yield* ServerProcess.run({
      mode: input.service ? "service" : input.stdio ? "stdio" : "default",
      hostname: Option.getOrUndefined(input.hostname),
      port: Option.getOrUndefined(input.port),
      cors: input.cors.length > 0 ? input.cors : undefined,
      // fork_change start - `--no-auth`. The refusals live in ServerProcess.run,
      // not here, because whether the bind is loopback is only known once the
      // hostname default has been applied.
      auth: input.auth,
      allowRemoteNoAuth: input.allowRemoteNoAuth,
      // fork_change end
    })
  }),
)
