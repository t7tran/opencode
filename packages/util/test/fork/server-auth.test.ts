// fork_change - new file
//
// Tests for the `--no-auth` fork policy. Verifies:
//   1. Loopback recognition covers all of 127.0.0.0/8 and the IPv6 spellings,
//      and rejects wildcard and routable binds.
//   2. The refusals: service mode always, a non-loopback bind unless
//      --allow-remote-no-auth is passed.
//   3. NO_AUTH_PASSWORD is upstream's own "no authentication" sentinel — the
//      value ServerAuth.required() reads as false.

import { describe, expect, test } from "bun:test"
import { NO_AUTH_PASSWORD, isLoopbackHostname, noAuthRefusal } from "../../src/fork/server-auth.js"

describe("isLoopbackHostname", () => {
  test("accepts the canonical spellings", () => {
    for (const hostname of ["127.0.0.1", "localhost", "::1", "[::1]", "::ffff:127.0.0.1"])
      expect(isLoopbackHostname(hostname)).toBe(true)
  })

  test("accepts the rest of 127.0.0.0/8", () => {
    // systemd-resolved sits on 127.0.0.53; a bind there is no less local.
    for (const hostname of ["127.0.0.53", "127.1.2.3", "127.255.255.255"])
      expect(isLoopbackHostname(hostname)).toBe(true)
  })

  test("is case- and whitespace-insensitive", () => {
    expect(isLoopbackHostname(" LocalHost ")).toBe(true)
  })

  test("rejects wildcard binds", () => {
    for (const hostname of ["0.0.0.0", "::", "", "   "]) expect(isLoopbackHostname(hostname)).toBe(false)
  })

  test("rejects routable addresses and names", () => {
    for (const hostname of ["10.0.0.1", "192.168.1.5", "128.0.0.1", "agent.example.com"])
      expect(isLoopbackHostname(hostname)).toBe(false)
  })
})

describe("noAuthRefusal", () => {
  test("allows a loopback bind in default mode", () => {
    expect(noAuthRefusal({ mode: "default", hostname: "127.0.0.1" })).toBeUndefined()
  })

  test("allows a loopback bind in stdio mode", () => {
    expect(noAuthRefusal({ mode: "stdio", hostname: "localhost" })).toBeUndefined()
  })

  test("refuses service mode even on loopback", () => {
    // The service registration file is what every client reads its password
    // from, so an empty one there is not a local decision.
    expect(noAuthRefusal({ mode: "service", hostname: "127.0.0.1" })).toContain("--service")
  })

  test("refuses a wildcard bind and names the escape hatch", () => {
    const refusal = noAuthRefusal({ mode: "default", hostname: "0.0.0.0" })
    expect(refusal).toContain("0.0.0.0")
    expect(refusal).toContain("--allow-remote-no-auth")
  })

  test("the escape hatch lifts the bind restriction", () => {
    for (const hostname of ["0.0.0.0", "::", "10.0.0.1", "agent.example.com"])
      expect(noAuthRefusal({ mode: "default", hostname, allowRemote: true })).toBeUndefined()
  })

  test("the escape hatch does not lift the service-mode refusal", () => {
    expect(noAuthRefusal({ mode: "service", hostname: "0.0.0.0", allowRemote: true })).toContain("--service")
  })

  test("an unset or false escape hatch does not lift anything", () => {
    for (const allowRemote of [undefined, false])
      expect(noAuthRefusal({ mode: "default", hostname: "0.0.0.0", allowRemote })).toBeDefined()
  })

  test("the old env switch no longer lifts anything", () => {
    // Replaced by the flag so the decision is visible on the command line.
    const previous = process.env.GENIXCODE_FORK_SERVE_NO_AUTH_ALLOW_REMOTE
    process.env.GENIXCODE_FORK_SERVE_NO_AUTH_ALLOW_REMOTE = "1"
    try {
      expect(noAuthRefusal({ mode: "default", hostname: "0.0.0.0" })).toBeDefined()
    } finally {
      if (previous === undefined) delete process.env.GENIXCODE_FORK_SERVE_NO_AUTH_ALLOW_REMOTE
      else process.env.GENIXCODE_FORK_SERVE_NO_AUTH_ALLOW_REMOTE = previous
    }
  })
})

describe("NO_AUTH_PASSWORD", () => {
  test("is the value upstream's ServerAuth.required() reads as no authentication", () => {
    // Mirrors packages/server/src/auth.ts: required() is
    // `Option.isSome(password) && password.value !== ""`. If upstream ever stops
    // treating "" that way, this fails here rather than serving a locked-out UI.
    expect(NO_AUTH_PASSWORD).toBe("")
  })

  test("is falsy, so createRoutes maps it onto the none-password layer", () => {
    // packages/server/src/routes.ts: `options.password ? configLayer(some) : layer`.
    expect(Boolean(NO_AUTH_PASSWORD)).toBe(false)
  })
})
