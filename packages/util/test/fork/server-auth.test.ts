// fork_change - new file
//
// Tests for the `--no-auth` fork policy. Verifies:
//   1. Loopback recognition covers all of 127.0.0.0/8 and the IPv6 spellings,
//      and rejects wildcard and routable binds.
//   2. The refusals: service mode always, a non-loopback bind unless the env
//      switch is set.
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
  const env = {}

  test("allows a loopback bind in default mode", () => {
    expect(noAuthRefusal({ mode: "default", hostname: "127.0.0.1", env })).toBeUndefined()
  })

  test("allows a loopback bind in stdio mode", () => {
    expect(noAuthRefusal({ mode: "stdio", hostname: "localhost", env })).toBeUndefined()
  })

  test("refuses service mode even on loopback", () => {
    // The service registration file is what every client reads its password
    // from, so an empty one there is not a local decision.
    expect(noAuthRefusal({ mode: "service", hostname: "127.0.0.1", env })).toContain("--service")
  })

  test("refuses a wildcard bind and names the escape hatch", () => {
    const refusal = noAuthRefusal({ mode: "default", hostname: "0.0.0.0", env })
    expect(refusal).toContain("0.0.0.0")
    expect(refusal).toContain("GENIX_SERVE_NO_AUTH_ALLOW_REMOTE")
  })

  test("the escape hatch lifts the bind restriction", () => {
    for (const value of ["1", "true", "TRUE"])
      expect(
        noAuthRefusal({ mode: "default", hostname: "0.0.0.0", env: { GENIX_SERVE_NO_AUTH_ALLOW_REMOTE: value } }),
      ).toBeUndefined()
  })

  test("the escape hatch does not lift the service-mode refusal", () => {
    expect(
      noAuthRefusal({ mode: "service", hostname: "127.0.0.1", env: { GENIX_SERVE_NO_AUTH_ALLOW_REMOTE: "1" } }),
    ).toContain("--service")
  })

  test("an unset or nonsense switch value does not lift anything", () => {
    for (const value of [undefined, "", "0", "false", "yes"])
      expect(
        noAuthRefusal({ mode: "default", hostname: "0.0.0.0", env: { GENIX_SERVE_NO_AUTH_ALLOW_REMOTE: value } }),
      ).toBeDefined()
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
