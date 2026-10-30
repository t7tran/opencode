export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service } from "@opencode/client/effect/service"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_VERSION } from "./version"
import { AppProcess } from "@opencode/util/process"
import { randomBytes, randomUUID } from "node:crypto"
import { Effect, Option, Redacted, Schema } from "effect"
import { PersistentPty } from "@opencode/schema/persistent-pty"
import { HttpServer } from "effect/http"
import { NetAddress } from "effect/net"
import { Env } from "./env"
import { ServiceConfig } from "./services/service-config"
import { RetainedImage } from "./services/retained-image"
import { ServiceRegistration } from "./services/service-registration"
import { RemoteTunnel } from "./services/remote-tunnel"
import { forkRemoteAccessEnabled } from "./fork/policy" // fork_change - no public tunnel
import { WebUi } from "./services/web-ui"
import { databasePath } from "./database-path"
import { CLI_NAME } from "@opencode/util/fork/brand" // fork_change - renamed binary
import { NO_AUTH_PASSWORD, noAuthRefusal } from "@opencode/util/fork/server-auth" // fork_change - `--no-auth`

export type Mode = "default" | "service" | "stdio"

export type Options = {
  readonly mode: Mode
  readonly hostname?: string
  readonly port?: number
  readonly cors?: readonly string[]
  // fork_change start - false serves unauthenticated; see fork/server-auth.ts
  readonly auth?: boolean
  readonly allowRemoteNoAuth?: boolean
  // fork_change end
}

// The process effect lives until server shutdown; tracing it would parent every request to one process-lifetime trace.
export const run = Effect.fnUntraced(function* (options: Options) {
  return yield* processEffect(options).pipe(
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), {
        replacements: [
          Global.node.replace(
            Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
          ),
        ],
      }),
    ),
    Effect.provide(NodeServices.layer),
  )
})

const processEffect = Effect.fnUntraced(function* (options: Options) {
  const inherited = process.env.OPENCODE_PTY_HANDOFF
  delete process.env.OPENCODE_PTY_HANDOFF
  const handoff =
    inherited === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PersistentPty.Handoff))(inherited).pipe(
          Effect.catch(() =>
            Effect.logWarning("Ignoring invalid PTY restart handoff; persistent terminals will start fresh").pipe(
              Effect.as(undefined),
            ),
          ),
        )
  const global = yield* Global.Service
  // A sandbox may deny $HOME; the service then keeps the cwd it was launched from.
  if (options.mode === "service")
    yield* Effect.try(() => process.chdir(global.home)).pipe(
      Effect.catch((cause) => Effect.logWarning("failed to change service directory to home", { cause })),
    )
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const foreground = options.mode === "default"
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      const config = options.mode === "service" ? yield* ServiceConfig.read() : {}
      const hostname = options.hostname ?? config.hostname ?? "127.0.0.1"
      const port = options.port ?? config.port ?? (options.mode === "service" ? ServiceConfig.defaultPort() : undefined)
      const findIncumbent =
        serviceOptions !== undefined && port !== undefined
          ? Service.incumbent({ ...serviceOptions, url: serviceURL(hostname, port) })
          : undefined
      if (findIncumbent !== undefined && (yield* findIncumbent) !== undefined) return
      // Desktop can launch the service directly without injecting its saved environment.
      Object.assign(process.env, config.env)
      // Keep a package-manager or curl install replaceable while the service runs; Desktop updates its own copy.
      if (options.mode === "service" && process.platform === "win32" && RetainedImage.installed(global.home))
        yield* RetainedImage.retain(global.cache, "service")
      const { start } = yield* Effect.promise(() => import("@opencode/server/process"))
      const environmentPassword = yield* Env.password
      // Keep the lease credential out of the environment inherited by tools.
      if (options.mode === "stdio") {
        delete process.env.OPENCODE_PASSWORD
        delete process.env.OPENCODE_SERVER_PASSWORD
      }
      // fork_change start - `--no-auth` routes onto the empty password that
      // ServerAuth.required() already reads as "no authentication", so nothing
      // downstream needs a new auth mode. Refusals (non-loopback bind, service
      // mode) are decided in fork/server-auth.ts, once `hostname` has defaulted.
      const noAuth = options.auth === false
      if (noAuth) {
        const refusal = noAuthRefusal({ mode: options.mode, hostname, allowRemote: options.allowRemoteNoAuth })
        if (refusal) return yield* Effect.fail(new Error(refusal))
      }
      // fork_change end
      const generated = // fork_change - renamed so upstream's ternary below stays byte-identical
        options.mode === "service"
          ? config.password || randomBytes(32).toString("base64url")
          : environmentPassword
            ? Redacted.value(environmentPassword)
            : randomBytes(32).toString("base64url")
      const password = noAuth ? NO_AUTH_PASSWORD : generated // fork_change - `--no-auth`
      if (!noAuth && !password) return yield* Effect.fail(new Error("Missing server password")) // fork_change - an empty password is `--no-auth`, not a missing one
      const instanceID = randomUUID()
      const transform = yield* WebUi.handler()
      const remote = { urls: [] as ReadonlyArray<string> }
      const launch = start(
        {
          app: {
            name: process.env.OPENCODE_CLIENT ?? OPENCODE_ARTIFACT,
            version: OPENCODE_VERSION,
            channel: OPENCODE_CHANNEL,
          },
          hostname,
          port,
          cors: options.cors ?? config.cors,
          password,
          pty: { handoff },
          simulation: truthy(process.env.OPENCODE_SIMULATE),
          database: {
            path: databasePath(global.data),
          },
          models: {
            url: process.env.OPENCODE_MODELS_URL,
            file: process.env.OPENCODE_MODELS_PATH,
            // fork_change start - this build is locked to a single self-hosted
            // provider, so there is no reason to contact the models.dev catalog
            // endpoint on startup: it is wasted latency and it leaks usage
            // metadata. Upstream read this from OPENCODE_DISABLE_MODELS_FETCH.
            fetch: false,
            // fork_change end
          },
          config: {
            directory: process.env.OPENCODE_CONFIG_DIR,
            project: !truthy(
              process.env.OPENCODE_CONFIG_PROJECT_DISABLE ?? process.env.OPENCODE_DISABLE_PROJECT_CONFIG,
            ),
            // .claude is only read for skills, so both flags gate the same roots.
            claude: !(
              truthy(process.env.OPENCODE_DISABLE_CLAUDE_CODE) ||
              truthy(process.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS)
            ),
            file: process.env.OPENCODE_CONFIG,
            content: process.env.OPENCODE_CONFIG_CONTENT,
          },
          windows: {
            gitbash: process.env.OPENCODE_GIT_BASH_PATH,
          },
          fs: {
            filewatcher: !truthy(process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER),
            fff:
              process.env.OPENCODE_DISABLE_FFF === undefined
                ? process.platform !== "win32"
                : !truthy(process.env.OPENCODE_DISABLE_FFF),
          },
        },
        serviceOptions === undefined
          ? undefined
          : {
              onListen: (address, shutdown) =>
                Effect.gen(function* () {
                  if (!config.password) yield* ServiceConfig.password(password)
                  return yield* ServiceRegistration.register({
                    address,
                    password,
                    id: instanceID,
                    file: serviceOptions.file,
                    shutdown,
                  })
                }),
            },
        transform,
        () => remote.urls,
      )
      const server = yield* launch.pipe(
        Effect.catch((error) => {
          if (findIncumbent === undefined || !addressInUse(error)) return Effect.fail(error)
          return Effect.gen(function* () {
            const deadline = Date.now() + 15_000
            while (Date.now() < deadline) {
              const found = yield* findIncumbent.pipe(Effect.timeoutOption(deadline - Date.now()))
              if (Option.isSome(found) && found.value !== undefined) return
              yield* Effect.sleep("100 millis")
              if (Date.now() >= deadline) break
              // Failed binds close their scope; a successful bind may take longer than this window to boot.
              const server = yield* launch.pipe(Effect.catchIf(addressInUse, () => Effect.void))
              if (server !== undefined) return server
            }
            return yield* Effect.fail(
              new Error(
                `Managed service port ${port} on ${hostname} is already in use by another process. ` +
                  `Configure another port with \`${CLI_NAME} service set port <port>\` and start the service again.`, // fork_change - renamed binary
                { cause: error },
              ),
            )
          })
        }),
      )
      if (server === undefined) return
      // fork_change start - a config that already has remote on (written before the fork disabled it) starts no tunnel
      if (config.remote !== undefined && !forkRemoteAccessEnabled())
        yield* Effect.logWarning("remote access skipped", { reason: "fork-disabled" })
      if (
        forkRemoteAccessEnabled() &&
        serviceOptions !== undefined &&
        config.remote !== undefined &&
        NetAddress.isInetAddress(server.address)
      ) {
        // fork_change end
        const bound = NetAddress.formatIp(server.address.address)
        // A wildcard bind also listens on loopback, which is all the tunnel needs to reach.
        const target =
          bound === "0.0.0.0" || bound === "::"
            ? `127.0.0.1:${server.address.port}`
            : NetAddress.formatInet(server.address)
        yield* Effect.forkScoped(
          RemoteTunnel.run({
            route: config.remote.route,
            target,
            onURL: (url) => {
              remote.urls = url === undefined ? [] : [url]
            },
          }),
        )
      }
      const url = HttpServer.formatAddress(server.address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      // fork_change start - do not print an empty password as if it were one,
      // and say plainly that the server is open, since that is the whole point
      // of the flag and the one thing an operator must not learn by accident.
      if (foreground && noAuth) console.log("authentication disabled (--no-auth)")
      else if (foreground && !environmentPassword) console.log(`server password ${password}`)
      // fork_change end
      return yield* options.mode === "service"
        ? server.shutdown
        : options.mode === "stdio"
          ? waitForStdinClose()
          : Effect.never
    }).pipe(Effect.annotateLogs({ role: "server" })),
  )
})

function serviceURL(hostname: string, port: number) {
  return `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`
}

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}

function addressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && error.code === "EADDRINUSE") return true
  return "cause" in error && addressInUse(error.cause)
}

function waitForStdinClose() {
  return Effect.callback<void>((resume) => {
    const close = () => resume(Effect.void)
    process.stdin.once("end", close)
    process.stdin.once("close", close)
    process.stdin.resume()
    if (process.stdin.readableEnded || process.stdin.destroyed) close()
    return Effect.sync(() => {
      process.stdin.off("end", close)
      process.stdin.off("close", close)
      process.stdin.pause()
    })
  })
}
