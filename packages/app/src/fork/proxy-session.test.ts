import { describe, expect, test } from "bun:test"
import { PROXY_SESSION_PROBE_PATH, PROXY_SESSION_RELOAD_COOLDOWN_MS, withProxySessionRecovery } from "./proxy-session"

const origin = "https://agent.example.test"

function opaqueRedirect() {
  const response = new Response(null, { status: 200 })
  Object.defineProperty(response, "type", { value: "opaqueredirect" })
  return response
}

function setup(input: {
  fail?: (url: URL) => unknown
  probe?: () => Promise<Response>
  hidden?: boolean
  storage?: Map<string, string>
  now?: number
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const reloads: number[] = []
  const visible: Array<() => void> = []
  const storage = input.storage ?? new Map<string, string>()
  let hidden = input.hidden ?? false
  const fetch = Object.assign(
    async (resource: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(resource instanceof Request ? resource.url : String(resource), origin)
      calls.push({ url: url.href, init })
      if (url.pathname === PROXY_SESSION_PROBE_PATH && init?.redirect === "manual") {
        return input.probe ? input.probe() : new Response("{}")
      }
      const failure = input.fail?.(url)
      if (failure) throw failure
      return new Response("ok")
    },
    { preconnect() {} },
  )
  const wrapped = withProxySessionRecovery(fetch, {
    origin,
    reload: () => reloads.push(1),
    hidden: () => hidden,
    onVisible: (callback) => visible.push(callback),
    now: () => input.now ?? 1_000_000,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
    },
    log: () => {},
  })
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const show = () => {
    hidden = false
    for (const callback of visible.splice(0)) callback()
  }
  return { wrapped, calls, reloads, settle, show, storage }
}

const corsFailure = (url: URL) => (url.pathname === "/api/session" ? new TypeError("Failed to fetch") : undefined)
const probes = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.filter((call) => call.url.endsWith(PROXY_SESSION_PROBE_PATH))

describe("withProxySessionRecovery", () => {
  test("passes successful requests through without probing", async () => {
    const input = setup({})
    const response = await input.wrapped(`${origin}/api/session`, { method: "POST" })
    expect(await response.text()).toBe("ok")
    expect(input.calls).toEqual([{ url: `${origin}/api/session`, init: { method: "POST" } }])
  })

  test("reloads when a failed request is explained by a redirecting proxy", async () => {
    const input = setup({ fail: corsFailure, probe: async () => opaqueRedirect() })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow("Failed to fetch")
    await input.settle()
    expect(probes(input.calls)).toHaveLength(1)
    expect(probes(input.calls)[0]!.init).toMatchObject({ redirect: "manual", cache: "no-store" })
    expect(input.reloads).toHaveLength(1)
  })

  test("leaves the page alone when the server is simply unreachable", async () => {
    const input = setup({ fail: corsFailure, probe: async () => Promise.reject(new TypeError("Failed to fetch")) })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.reloads).toHaveLength(0)
  })

  test("leaves the page alone when the probe gets a normal answer", async () => {
    const input = setup({ fail: corsFailure })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(1)
    expect(input.reloads).toHaveLength(0)
  })

  test("shares one probe across a burst of failures and reloads once", async () => {
    const input = setup({ fail: corsFailure, probe: async () => opaqueRedirect() })
    await Promise.allSettled([1, 2, 3].map(() => input.wrapped(`${origin}/api/session`)))
    await input.settle()
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(1)
    expect(input.reloads).toHaveLength(1)
  })

  test("does not probe for aborted or timed-out requests", async () => {
    const input = setup({
      fail: (url) =>
        url.pathname === "/api/session" ? new DOMException("Timed out waiting", "TimeoutError") : undefined,
      probe: async () => opaqueRedirect(),
    })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(0)
  })

  test("ignores requests to other origins", async () => {
    const input = setup({ fail: () => new TypeError("Failed to fetch"), probe: async () => opaqueRedirect() })
    await expect(input.wrapped("https://elsewhere.example.test/api/session")).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(0)
  })

  test("waits for a hidden tab to become visible before reloading", async () => {
    const input = setup({ fail: corsFailure, probe: async () => opaqueRedirect(), hidden: true })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.reloads).toHaveLength(0)
    input.show()
    expect(input.reloads).toHaveLength(1)
  })

  test("does not reload again within the cooldown of the last reload", async () => {
    const now = 1_000_000
    const storage = new Map([["genixcode.fork.proxySession.reloadedAt", String(now - 5_000)]])
    const input = setup({ fail: corsFailure, probe: async () => opaqueRedirect(), storage, now })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.reloads).toHaveLength(0)

    const later = setup({
      fail: corsFailure,
      probe: async () => opaqueRedirect(),
      storage,
      now: now + PROXY_SESSION_RELOAD_COOLDOWN_MS,
    })
    await expect(later.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await later.settle()
    expect(later.reloads).toHaveLength(1)
  })
})
