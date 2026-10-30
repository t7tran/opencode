// fork_change - new file
//
// Tests for the managed key on the gateway's own MCP endpoint (lock.ts). Verifies:
//   1. A server on the gateway's origin gets the managed key as its bearer token,
//      with redirects refused.
//   2. Any other credential the config tried to present to the gateway is dropped,
//      whatever its case; unrelated headers survive.
//   3. Nothing else gets the key: another host, a lookalike host, another scheme or
//      port, a malformed URL.
//   4. Nothing happens without a managed key, or with the lock off.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gatewayMcpRequestInit, isGatewayMcp } from "../../src/fork/lock.js"

const ORIGINAL = {
  keyFile: process.env.GENIXCODE_FORK_KEY_FILE,
  lock: process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK,
}
const GATEWAY_MCP = "https://ai.gateway.genixventures.com/mcp"
const KEY = "sk-bf-test-managed-key"

let dir: string

beforeEach(() => {
  // The global test preload disables the fork lock; these tests cover the locked behaviour.
  process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK = ""
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-gateway-mcp-"))
  process.env.GENIXCODE_FORK_KEY_FILE = path.join(dir, "kilo.key")
  fs.writeFileSync(process.env.GENIXCODE_FORK_KEY_FILE, KEY + "\n")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  if (ORIGINAL.keyFile === undefined) delete process.env.GENIXCODE_FORK_KEY_FILE
  else process.env.GENIXCODE_FORK_KEY_FILE = ORIGINAL.keyFile
  if (ORIGINAL.lock === undefined) delete process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK
  else process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK = ORIGINAL.lock
})

describe("fork.lock gateway MCP", () => {
  test("the gateway's MCP endpoint gets the managed key and refuses redirects", () => {
    expect(isGatewayMcp(GATEWAY_MCP)).toBe(true)
    expect(gatewayMcpRequestInit(GATEWAY_MCP)).toEqual({
      headers: { Authorization: `Bearer ${KEY}` },
      redirect: "error",
    })
  })

  test("any path on the gateway's origin counts, and a URL object works as well as a string", () => {
    expect(gatewayMcpRequestInit(new URL("https://ai.gateway.genixventures.com/other/mcp?x=1"))?.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
    })
  })

  test("a credential from config is replaced, whatever header or case it used; other headers stay", () => {
    const init = gatewayMcpRequestInit(GATEWAY_MCP, {
      authorization: "Bearer someone-else",
      "X-BF-VK": "sk-bf-someone-else",
      "x-api-key": "sk-bf-someone-else",
      "X-Goog-Api-Key": "sk-bf-someone-else",
      "x-bf-mcp-include-tools": "web_search-*",
    })
    expect(init?.headers).toEqual({
      "x-bf-mcp-include-tools": "web_search-*",
      Authorization: `Bearer ${KEY}`,
    })
  })

  test("no other server gets the key", () => {
    for (const url of [
      "https://mcp.atlassian.com/v2/mcp",
      "https://ai.gateway.genixventures.com.attacker.test/mcp",
      "https://attacker.test/ai.gateway.genixventures.com/mcp",
      "https://evil.ai.gateway.genixventures.com/mcp",
      "http://ai.gateway.genixventures.com/mcp",
      "https://ai.gateway.genixventures.com:8443/mcp",
      "not a url",
    ]) {
      expect(isGatewayMcp(url)).toBe(false)
      expect(gatewayMcpRequestInit(url, { Authorization: "Bearer theirs" })).toBeUndefined()
    }
  })

  test("nothing is pinned without a managed key", () => {
    fs.rmSync(process.env.GENIXCODE_FORK_KEY_FILE!)
    expect(isGatewayMcp(GATEWAY_MCP)).toBe(false)
    expect(gatewayMcpRequestInit(GATEWAY_MCP)).toBeUndefined()
  })

  test("nothing is pinned with the lock off", () => {
    process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK = "1"
    expect(gatewayMcpRequestInit(GATEWAY_MCP)).toBeUndefined()
  })
})
