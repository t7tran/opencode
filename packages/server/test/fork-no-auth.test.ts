// `genixcode serve --no-auth` against the real server process.
//
// The CLI turns the flag into an empty password (NO_AUTH_PASSWORD in
// packages/util/src/fork/server-auth.ts), and the fork's three hunks in
// src/process.ts let that reach upstream's own "no password" handling: the
// start guard tests `undefined` rather than falsy, and the pre-boot gate in
// dispatch() honours ServerAuth.required(). Upstream keeps adding gates to that
// function (the pairing-link exemption arrived in v2.0.21), so this pins the
// behaviour end to end rather than trusting the merge.

import { expect } from "bun:test"
import { Effect, Option } from "effect"
import { HttpServer } from "effect/unstable/http"
import { NO_AUTH_PASSWORD } from "@opencode/util/fork/server-auth"
import { it } from "../../core/test/lib/effect"
import { ServerAuth } from "../src/auth"
import { ServerProcess } from "../src/process"

const start = (password: string) =>
  ServerProcess.start<never, never>({
    hostname: "127.0.0.1",
    port: 0,
    password,
    app: { version: "test-version" },
    database: { path: ":memory:" },
  })

const info = (address: HttpServer.Address, headers?: Record<string, string>) =>
  Effect.promise(() => fetch(new URL("/api/info", HttpServer.formatAddress(address)), { headers }))

it.live("upstream still reads the empty password as no authentication", () =>
  Effect.sync(() => {
    expect(ServerAuth.required({ password: Option.some(NO_AUTH_PASSWORD), username: "opencode" })).toBe(false)
    expect(ServerAuth.required({ password: Option.some("secret"), username: "opencode" })).toBe(true)
  }),
)

it.live("serves the API without credentials under --no-auth", () =>
  Effect.gen(function* () {
    const server = yield* start(NO_AUTH_PASSWORD)
    const response = yield* info(server.address)
    expect(response.status).toBe(200)
    expect(response.headers.get("www-authenticate")).toBeNull()
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ version: "test-version" })
  }),
)

it.live("still refuses an unauthenticated request when a password is set", () =>
  Effect.gen(function* () {
    const server = yield* start("secret")
    expect((yield* info(server.address)).status).toBe(401)
    const authorized = yield* info(server.address, { authorization: `Basic ${btoa("opencode:secret")}` })
    expect(authorized.status).toBe(200)
  }),
)
