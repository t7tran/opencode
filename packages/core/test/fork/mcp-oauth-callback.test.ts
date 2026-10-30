// fork_change - new file
//
// The MCP OAuth callback when the redirect URI names another host, at the point
// core opens the listener (packages/core/src/mcp/oauth.ts). Which address the
// policy picks is tested in packages/util/test/fork/mcp-oauth-callback.test.ts;
// this pins the seam: a callback delivered to the machine's network address,
// the way a proxy or tunnel delivers it, completes the sign-in. A rebase that
// takes upstream's hard-coded 127.0.0.1 back shows up here as a refused fetch.

import { expect, test } from "bun:test"
import os from "node:os"
import { Effect } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { McpOAuth } from "@opencode/core/mcp/oauth"

// The first non-loopback IPv4 address, which is where a proxy on another host
// would deliver the callback. A machine without one can't show the difference.
const networkAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address

const freePort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  return port
}

const credentials = Credential.Service.of({
  all: () => Effect.die("unused"),
  create: () => Effect.die("unused"),
  activate: () => Effect.die("unused"),
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  update: () => Effect.void,
  remove: () => Effect.void,
})

test.skipIf(!networkAddress)("takes the callback on the network address for a redirect URI on another host", async () => {
  const tokenRequests: URLSearchParams[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
      tokenRequests.push(new URLSearchParams(await request.text()))
      return Response.json({ access_token: "access", token_type: "Bearer" })
    },
  })
  const port = freePort()
  const path = `/absproxy/${port}/mcp/oauth/callback`

  const credential = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const authorization = yield* McpOAuth.authorize({
          name: "test",
          config: new ConfigMCP.Remote({
            type: "remote",
            url: server.url.href,
            oauth: { client_id: "client", redirect_uri: `https://editor.example.test${path}`, callback_port: port },
          }),
          integrationID: Integration.ID.make("mcp_test"),
          methodID: Integration.MethodID.make("oauth"),
        })
        const state = new URL(authorization.url).searchParams.get("state")
        if (!state) throw new Error("Missing OAuth state")
        const callback = new URL(`http://${networkAddress}:${port}${path}`)
        callback.searchParams.set("code", "accepted")
        callback.searchParams.set("state", state)
        expect((yield* Effect.promise(() => fetch(callback))).status).toBe(200)
        return yield* authorization.callback
      }).pipe(Effect.provideService(Credential.Service, credentials)),
    ),
  ).finally(() => server.stop(true))

  expect(credential.access).toBe("access")
  expect(tokenRequests[0]?.get("code")).toBe("accepted")
})
