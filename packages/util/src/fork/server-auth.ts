// fork_change - new file
//
// Fork policy for `genixcode serve --no-auth`.
//
// Upstream has no way to serve the v2 API and web UI unauthenticated. The server
// refuses to start without a password (`packages/server/src/process.ts`) and the
// CLI invents a random one per start (`packages/cli/src/server-process.ts`), so
// the UI is always behind HTTP Basic. That is the right default for a laptop. It
// is the wrong one for a deployment where something in front has already done the
// authenticating — a Kong instance running an OIDC plugin, a Cloudflare Access
// application, an nginx sidecar — and where the only thing the password buys is a
// browser auth dialog, or an `?auth_token=` query param the user has to be handed
// out of band.
//
// What makes this a small change is that upstream already has the notion of "no
// password" and wires it correctly end to end:
//
//   * `ServerAuth.required()` reads an EMPTY password as "no authentication".
//   * `createRoutes()` maps a falsy `options.password` onto `Option.none()`, which
//     makes `authorizationLayer` a pass-through.
//   * `createEmbeddedRoutes()` does the same unconditionally, for embedders that
//     front the handler with their own auth.
//
// So the fork does not add an auth mode. It routes `--no-auth` onto the empty
// password upstream already understands, and removes the two guards that stop an
// empty one reaching the layer. That is deliberately the whole design: a rebase
// has three short marked hunks to reconcile rather than a parallel auth path.
//
// See FORK.md § Serving without authentication.

/**
 * The password that means "do not authenticate".
 *
 * Empty, not undefined, and that distinction is load-bearing. Upstream's guards
 * exist to catch a password that was never supplied — a missing env var, a
 * service config that failed to load — and that failure should still be loud.
 * `--no-auth` is the opposite: an explicit request, so it carries an explicit
 * value. The guards change from "is it truthy" to "is it defined", which keeps
 * the accident they were written for failing and lets the intent through.
 */
export const NO_AUTH_PASSWORD = ""

/** Hostnames that keep an unauthenticated server off the network. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "::ffff:127.0.0.1"])

/**
 * Whether binding here keeps the server reachable only from inside its own
 * host — the whole basis for allowing `--no-auth` at all.
 *
 * The whole of `127.0.0.0/8` is loopback, not just `127.0.0.1`, so a bind to
 * `127.0.0.53` is as local as the canonical spelling. An empty hostname or
 * `0.0.0.0`/`::` is a wildcard bind, which is the case this exists to catch.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (normalized === "") return false
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
}

/** Env switch that lifts the loopback restriction. See `noAuthRefusal`. */
const ALLOW_REMOTE_ENV = "GENIX_SERVE_NO_AUTH_ALLOW_REMOTE"

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true"
}

/**
 * Why `--no-auth` must be refused for this invocation, or undefined when it is
 * allowed.
 *
 * Two refusals, for quite different reasons.
 *
 * **A non-loopback bind.** An unauthenticated genixcode server is a remote shell:
 * the API reads and writes the filesystem, runs commands and hands out PTYs. On
 * `127.0.0.1` that is no worse than the account already running the process. On
 * `0.0.0.0` it is that capability offered to anything that can route to the port.
 * The flag is therefore loopback-only by default, and a deployment that really
 * does terminate auth on another host sets `GENIX_SERVE_NO_AUTH_ALLOW_REMOTE=1`
 * and owns the consequence. An env switch is the right shape here — unlike the
 * updater's compile-time `define`, which guards against a Genix build replacing
 * itself with an upstream one and so must not be reachable at runtime at all.
 *
 * **Service mode.** `--service` is the background service the desktop app spawns
 * and discovers. Its password is not decoration: it is written to the service
 * registration file, and every client that finds the service reads it from there
 * and presents it. Serving that unauthenticated would hand the user's own machine
 * an unauthenticated agent server they never asked for, on a port they did not
 * choose, started on their behalf. The deployment case this flag exists for runs
 * a plain foreground `serve`, so nothing is lost by refusing.
 */
export function noAuthRefusal(input: {
  readonly mode: "default" | "service" | "stdio"
  readonly hostname: string
  readonly env?: Record<string, string | undefined>
}): string | undefined {
  if (input.mode === "service")
    return "--no-auth cannot be combined with --service: the background service's password is what its clients authenticate with."
  const env = input.env ?? process.env
  if (isLoopbackHostname(input.hostname) || truthy(env[ALLOW_REMOTE_ENV])) return undefined
  return (
    `--no-auth refuses to bind ${input.hostname}: an unauthenticated server exposes filesystem and shell access to anything that can reach the port. ` +
    `Bind a loopback address, or set ${ALLOW_REMOTE_ENV}=1 if something in front of it is doing the authenticating.`
  )
}
