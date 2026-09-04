// fork_change - new file
//
// Tests for gateway model discovery. Verifies:
//   1. The OpenAI-compatible /models payload is shaped into a config model map.
//   2. Entries without a usable id are dropped; a missing name falls back to the id.
//   3. A non-2xx response rejects from fetchGatewayModels.
//   4. cachedGatewayModels never rejects, surfaces the error, and memoises
//      successful non-empty results (but not empty ones or failures).
//   5. The request carries an explicit User-Agent rather than the runtime default.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cachedGatewayModels, clearGatewayModelCache, fetchGatewayModels } from "../../src/fork/gateway"

const BASE = "https://gateway.example/v1"
const originalFetch = globalThis.fetch

let calls: string[]
let headers: Array<Record<string, string>>

function stub(handler: (url: string) => Response | Promise<Response>) {
  // Every call site in this module passes a plain string URL.
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push(url)
    headers.push((init?.headers ?? {}) as Record<string, string>)
    return Promise.resolve(handler(url))
  }) as unknown as typeof fetch
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  calls = []
  headers = []
  clearGatewayModelCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  clearGatewayModelCache()
})

describe("fork.gateway fetchGatewayModels", () => {
  test("shapes the /models payload into a config model map", async () => {
    stub(() => json({ data: [{ id: "gpt-x", name: "GPT X" }, { id: "gpt-y" }] }))
    const models = await fetchGatewayModels(BASE, "sk-test")
    expect(models).toEqual({ "gpt-x": { name: "GPT X" }, "gpt-y": { name: "gpt-y" } })
    expect(calls).toEqual([`${BASE}/models`])
  })

  test("trims a trailing slash off the base URL", async () => {
    stub(() => json({ data: [] }))
    await fetchGatewayModels(BASE + "///", "sk-test")
    expect(calls).toEqual([`${BASE}/models`])
  })

  test("drops entries with no usable id", async () => {
    stub(() => json({ data: [{ id: "  " }, { name: "no id" }, { id: " gpt-z " }] }))
    expect(await fetchGatewayModels(BASE, "sk-test")).toEqual({ "gpt-z": { name: "gpt-z" } })
  })

  test("tolerates a payload with no data array", async () => {
    stub(() => json({}))
    expect(await fetchGatewayModels(BASE, "sk-test")).toEqual({})
  })

  test("sends an explicit User-Agent instead of the runtime default", async () => {
    stub(() => json({ data: [] }))
    await fetchGatewayModels(BASE, "sk-test")
    expect(headers[0]["User-Agent"]).toMatch(/^genixcode\//) // fork_change - renamed binary
  })

  test("rejects on a non-2xx response", async () => {
    stub(() => json({ error: "nope" }, 401))
    let thrown: unknown
    await fetchGatewayModels(BASE, "sk-bad").catch((error: unknown) => {
      thrown = error
    })
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("HTTP 401")
  })
})

describe("fork.gateway cachedGatewayModels", () => {
  test("returns the error instead of rejecting", async () => {
    stub(() => {
      throw new Error("offline")
    })
    const result = await cachedGatewayModels(BASE, "sk-test")
    expect(result.models).toEqual({})
    expect(result.error).toBeDefined()
  })

  test("memoises a successful non-empty result", async () => {
    stub(() => json({ data: [{ id: "gpt-x", name: "GPT X" }] }))
    await cachedGatewayModels(BASE, "sk-test")
    await cachedGatewayModels(BASE, "sk-test")
    expect(calls).toHaveLength(1)
  })

  test("does not memoise an empty result", async () => {
    stub(() => json({ data: [] }))
    await cachedGatewayModels(BASE, "sk-test")
    await cachedGatewayModels(BASE, "sk-test")
    expect(calls).toHaveLength(2)
  })

  test("does not memoise a failure, so an outage self-heals", async () => {
    let fail = true
    stub(() => (fail ? json({}, 500) : json({ data: [{ id: "gpt-x" }] })))
    expect((await cachedGatewayModels(BASE, "sk-test")).error).toBeDefined()
    fail = false
    expect((await cachedGatewayModels(BASE, "sk-test")).models).toEqual({ "gpt-x": { name: "gpt-x" } })
  })

  test("caches per key, so a rotated key re-fetches", async () => {
    stub(() => json({ data: [{ id: "gpt-x" }] }))
    await cachedGatewayModels(BASE, "sk-one")
    await cachedGatewayModels(BASE, "sk-two")
    expect(calls).toHaveLength(2)
  })
})
