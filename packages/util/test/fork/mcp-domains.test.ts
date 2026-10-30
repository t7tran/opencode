// fork_change - new file
//
// The MCP outbound domain allowlist (src/fork/mcp-domains.ts), and the lock's
// guard predicates that let MCP integrations through (src/fork/guard.ts).

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  allowlistedFetch,
  domainAllowlist,
  domainsFilePath,
  DEFAULT_DOMAINS_FILE,
  hostAllowed,
  mcpDomainRefusal,
  McpDomainRefusedError,
  parseDomains,
} from "../../src/fork/mcp-domains.js"
import { credentialRefusal, isMcpIntegration, managedCredentialRefusal } from "../../src/fork/guard.js"

let dir: string
let file: string
const saved = { ...process.env }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-mcp-domains-"))
  file = path.join(dir, "genixcode.domains")
  process.env.GENIXCODE_FORK_DOMAINS_FILE = file
})

afterEach(() => {
  process.env = { ...saved }
  fs.rmSync(dir, { recursive: true, force: true })
})

// mtime granularity can make two writes in one tick look identical to the cache.
function write(text: string) {
  fs.writeFileSync(file, text)
  const later = new Date(Date.now() + Math.floor(Math.random() * 100_000))
  fs.utimesSync(file, later, later)
}

describe("fork.mcp-domains file", () => {
  test("defaults to /etc/genixcode.domains", () => {
    delete process.env.GENIXCODE_FORK_DOMAINS_FILE
    expect(domainsFilePath()).toBe(DEFAULT_DOMAINS_FILE)
    expect(DEFAULT_DOMAINS_FILE).toBe("/etc/genixcode.domains")
  })

  test("no file means no restriction", () => {
    expect(domainAllowlist()).toBeUndefined()
    expect(mcpDomainRefusal("https://anything.example.org/mcp")).toBeUndefined()
  })

  test("an unreadable file allows nothing", () => {
    if (process.getuid?.() === 0) return // root reads through chmod 000
    write("mcp.example.com\n")
    fs.chmodSync(file, 0o000)
    expect(mcpDomainRefusal("https://mcp.example.com/mcp")).toContain("not allowed")
  })

  test("an empty file allows nothing but loopback", () => {
    write("# nothing yet\n")
    expect(mcpDomainRefusal("https://mcp.example.com/mcp")).toContain("mcp.example.com")
    expect(mcpDomainRefusal("http://127.0.0.1:3000/mcp")).toBeUndefined()
    expect(mcpDomainRefusal("http://localhost:3000/mcp")).toBeUndefined()
    expect(mcpDomainRefusal("http://[::1]:3000/mcp")).toBeUndefined()
  })

  test("edits take effect without a restart", () => {
    write("a.example.com\n")
    expect(mcpDomainRefusal("https://b.example.com/")).toBeDefined()
    write("a.example.com\nb.example.com\n")
    expect(mcpDomainRefusal("https://b.example.com/")).toBeUndefined()
  })

  test("refuses non-HTTP URLs and does not name the file", () => {
    write("mcp.example.com\n")
    expect(mcpDomainRefusal("ftp://mcp.example.com/")).toContain("not an HTTP URL")
    expect(mcpDomainRefusal("https://evil.example.org/")).not.toContain(file)
  })
})

describe("fork.mcp-domains matching", () => {
  const list = parseDomains(
    ["# comment", "", "  MCP.Example.com.  # trailing comment", "*.corp.example.net", "bücher.example"].join("\n"),
  )

  test("exact hosts, case and trailing dot insensitive", () => {
    expect(hostAllowed("mcp.example.com", list)).toBe(true)
    expect(hostAllowed("MCP.EXAMPLE.COM", list)).toBe(true)
    expect(hostAllowed("other.example.com", list)).toBe(false)
    expect(hostAllowed("example.com", list)).toBe(false)
  })

  test("a wildcard covers subdomains but not the apex", () => {
    expect(hostAllowed("a.corp.example.net", list)).toBe(true)
    expect(hostAllowed("a.b.corp.example.net", list)).toBe(true)
    expect(hostAllowed("corp.example.net", list)).toBe(false)
    expect(hostAllowed("evilcorp.example.net", list)).toBe(false)
  })

  test("internationalised entries match the punycode a URL produces", () => {
    expect(hostAllowed(new URL("https://bücher.example/").hostname, list)).toBe(true)
  })
})

type Call = { url: string; method: string; headers: Headers; body: unknown }

function stub(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    }
    calls.push(call)
    const route = routes[call.url]
    if (!route) throw new Error(`unexpected request ${call.url}`)
    return route(call)
  }
  return { fetch, calls }
}

const redirect = (status: number, location: string) => () => new Response(null, { status, headers: { location } })

describe("fork.mcp-domains allowlistedFetch", () => {
  test("passes straight through when no allowlist is configured", async () => {
    const { fetch, calls } = stub({ "https://anywhere.example.org/": () => new Response("ok") })
    const response = await allowlistedFetch(fetch)("https://anywhere.example.org/", { redirect: "follow" })
    expect(await response.text()).toBe("ok")
    expect(calls).toHaveLength(1)
  })

  test("refuses a disallowed host before anything is sent", async () => {
    write("mcp.example.com\n")
    const { fetch, calls } = stub({})
    await expect(allowlistedFetch(fetch)("https://evil.example.org/mcp")).rejects.toBeInstanceOf(McpDomainRefusedError)
    expect(calls).toHaveLength(0)
  })

  test("re-checks every redirect hop, so an allowed host cannot bounce a request elsewhere", async () => {
    write("mcp.example.com\n")
    const { fetch, calls } = stub({ "https://mcp.example.com/mcp": redirect(307, "https://evil.example.org/collect") })
    await expect(
      allowlistedFetch(fetch)("https://mcp.example.com/mcp", { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(McpDomainRefusedError)
    expect(calls.map((call) => call.url)).toEqual(["https://mcp.example.com/mcp"])
  })

  test("follows allowed hops with fetch's method rules and drops credentials across origins", async () => {
    write("mcp.example.com\nauth.example.com\n")
    const { fetch, calls } = stub({
      "https://mcp.example.com/a": redirect(307, "/b"),
      "https://mcp.example.com/b": redirect(302, "https://auth.example.com/c"),
      "https://auth.example.com/c": () => new Response("done"),
    })
    const response = await allowlistedFetch(fetch)("https://mcp.example.com/a", {
      method: "POST",
      body: "{}",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
    })
    expect(await response.text()).toBe("done")
    expect(calls.map((call) => [call.url, call.method])).toEqual([
      ["https://mcp.example.com/a", "POST"],
      ["https://mcp.example.com/b", "POST"],
      ["https://auth.example.com/c", "GET"],
    ])
    // 307 keeps method, body and same-origin credentials.
    expect(calls[1]!.body).toBe("{}")
    expect(calls[1]!.headers.get("authorization")).toBe("Bearer secret")
    // 302 from a POST becomes a bodiless GET, and the token stays on its origin.
    expect(calls[2]!.body).toBeUndefined()
    expect(calls[2]!.headers.get("authorization")).toBeNull()
    expect(calls[2]!.headers.get("content-type")).toBeNull()
  })

  test("honours redirect: manual and redirect: error", async () => {
    write("mcp.example.com\n")
    const { fetch } = stub({ "https://mcp.example.com/a": redirect(302, "/b") })
    expect((await allowlistedFetch(fetch)("https://mcp.example.com/a", { redirect: "manual" })).status).toBe(302)
    await expect(allowlistedFetch(fetch)("https://mcp.example.com/a", { redirect: "error" })).rejects.toThrow(
      "redirected",
    )
  })
})

describe("fork.guard MCP integrations", () => {
  let keyFile: string
  beforeEach(() => {
    keyFile = path.join(dir, "kilo.key")
    process.env.GENIXCODE_FORK_DISABLE_PROVIDER_LOCK = ""
    process.env.GENIXCODE_FORK_KEY_FILE = keyFile
  })

  test("recognises only the id shape core's MCP layer produces", () => {
    expect(isMcpIntegration("mcp_0123456789abcdef")).toBe(true)
    expect(isMcpIntegration("mcp_0123456789abcde")).toBe(false)
    expect(isMcpIntegration("mcp_0123456789ABCDEF")).toBe(false)
    expect(isMcpIntegration("mcp_server")).toBe(false)
    expect(isMcpIntegration("genix")).toBe(false)
  })

  test("the lock refuses other providers but not MCP servers", () => {
    expect(credentialRefusal("openai")).toBeDefined()
    expect(credentialRefusal("mcp_0123456789abcdef")).toBeUndefined()
    expect(credentialRefusal("genix")).toBeUndefined()
  })

  test("a managed key refuses only Genix's own credential", () => {
    fs.writeFileSync(keyFile, "sk-managed")
    expect(credentialRefusal("genix")).toBeDefined()
    expect(credentialRefusal("mcp_0123456789abcdef")).toBeUndefined()
    expect(managedCredentialRefusal("genix")).toBeDefined()
    expect(managedCredentialRefusal(undefined)).toBeDefined()
    expect(managedCredentialRefusal("mcp_0123456789abcdef")).toBeUndefined()
  })

  test("without a managed key nothing is refused on removal", () => {
    expect(managedCredentialRefusal("genix")).toBeUndefined()
  })
})
