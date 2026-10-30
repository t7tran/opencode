// The MCP domain allowlist at the point core connects a remote server
// (packages/core/src/mcp/client.ts). The predicate itself is tested in
// packages/util/test/fork/mcp-domains.test.ts; this pins the seam, so a rebase
// that takes upstream's client.ts wholesale shows up here.

import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Exit } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { McpClient } from "@opencode/core/mcp/client"
import { hostEnvironmentLayer } from "../fixture/environment"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-core-mcp-domains-"))
  process.env.GENIXCODE_FORK_DOMAINS_FILE = path.join(dir, "genixcode.domains")
  fs.writeFileSync(process.env.GENIXCODE_FORK_DOMAINS_FILE, "mcp.example.com\n")
})

afterEach(() => {
  delete process.env.GENIXCODE_FORK_DOMAINS_FILE
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a remote MCP server outside the allowlist is refused before it is contacted", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      McpClient.connect(
        "blocked",
        new ConfigMCP.Remote({ type: "remote", url: "https://mcp.not-allowed.invalid/mcp", oauth: false }),
        dir,
      ).pipe(Effect.provide(hostEnvironmentLayer)),
    ),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain(
    "MCP connections to mcp.not-allowed.invalid are not allowed on this machine.",
  )
})
