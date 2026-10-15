// fork_change - new file
//
// Tests for where the MCP OAuth callback listens. Verifies:
//   1. No redirect URI, or a loopback one, keeps upstream's 127.0.0.1.
//   2. A redirect URI on another host listens on every address, so the proxy
//      or tunnel delivering the callback can reach it.

import { describe, expect, test } from "bun:test"
import { mcpOAuthCallbackHost } from "../../src/fork/mcp-oauth-callback.js"

describe("mcpOAuthCallbackHost", () => {
  test("keeps loopback without a redirect URI", () => {
    expect(mcpOAuthCallbackHost(undefined)).toBe("127.0.0.1")
  })

  test("keeps loopback for a loopback redirect URI", () => {
    for (const uri of [
      "http://127.0.0.1:19876/mcp/oauth/callback",
      "http://localhost:19876/mcp/oauth/callback",
      "http://[::1]:19876/mcp/oauth/callback",
      "http://127.0.0.53:19876/callback",
    ])
      expect(mcpOAuthCallbackHost(new URL(uri))).toBe("127.0.0.1")
  })

  test("listens on every address for a redirect URI on another host", () => {
    for (const uri of [
      "https://editor.example.workspace.genix.cloud/absproxy/19876/mcp/oauth/callback",
      "http://10.0.0.5:19876/mcp/oauth/callback",
    ])
      expect(mcpOAuthCallbackHost(new URL(uri))).toBe("0.0.0.0")
  })
})
