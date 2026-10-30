// fork_change - new file
//
// The managed key on the gateway's own MCP endpoint, at the point core opens a
// remote server's transport (packages/core/src/mcp/client.ts). What goes into the
// headers is tested in packages/util/test/fork/gateway-mcp.test.ts; this pins the
// seam, so a rebase that takes upstream's client.ts wholesale shows up here.

import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { McpClient } from "@opencode/core/mcp/client"
import { hostEnvironmentLayer } from "../fixture/environment"

const KEY = "sk-bf-test-managed-key"
const ORIGINAL = {
  keyFile: process.env.GENIXCODE_FORK_KEY_FILE,
  lock: process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK,
}
const realFetch = globalThis.fetch

let dir: string
let sent: { url: string; headers: Headers; redirect: RequestInit["redirect"] }[]

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-core-gateway-mcp-"))
  process.env.GENIXCODE_FORK_KEY_FILE = path.join(dir, "kilo.key")
  fs.writeFileSync(process.env.GENIXCODE_FORK_KEY_FILE, KEY)
  process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK = ""
  sent = []
  // Nothing is reached: every request is recorded and refused, so connect fails
  // after the first one and the test reads what that request carried.
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers), redirect: init?.redirect })
    return new Response("refused in test", { status: 500 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  fs.rmSync(dir, { recursive: true, force: true })
  if (ORIGINAL.keyFile === undefined) delete process.env.GENIXCODE_FORK_KEY_FILE
  else process.env.GENIXCODE_FORK_KEY_FILE = ORIGINAL.keyFile
  if (ORIGINAL.lock === undefined) delete process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK
  else process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK = ORIGINAL.lock
})

const connect = (url: string, headers?: Record<string, string>) =>
  Effect.runPromiseExit(
    Effect.scoped(
      McpClient.connect("server", new ConfigMCP.Remote({ type: "remote", url, oauth: false, headers }), dir).pipe(
        Effect.provide(hostEnvironmentLayer),
      ),
    ),
  )

test("the gateway's MCP endpoint is sent the managed key, in place of one from config, with redirects refused", async () => {
  await connect("https://ai.gateway.genixventures.com/mcp", { Authorization: "Bearer theirs", "x-bf-vk": "theirs" })
  expect(sent.length).toBeGreaterThan(0)
  for (const request of sent) {
    expect(new URL(request.url).origin).toBe("https://ai.gateway.genixventures.com")
    expect(request.headers.get("authorization")).toBe(`Bearer ${KEY}`)
    expect(request.headers.get("x-bf-vk")).toBeNull()
    expect(request.redirect).toBe("error")
  }
})

test("any other remote server keeps its configured headers and never sees the managed key", async () => {
  await connect("https://mcp.example.com/mcp", { Authorization: "Bearer theirs" })
  expect(sent.length).toBeGreaterThan(0)
  for (const request of sent) {
    expect(request.headers.get("authorization")).toBe("Bearer theirs")
    expect(request.redirect).not.toBe("error")
  }
})
