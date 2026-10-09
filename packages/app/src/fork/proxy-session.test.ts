import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
  PROXY_SESSION_NAVIGATION_DENYLIST,
  PROXY_SESSION_PROBE_PATH,
  PROXY_SESSION_REAUTH_PARAM,
  PROXY_SESSION_REAUTH_PATTERN,
  PROXY_SESSION_RELOGIN_COOLDOWN_MS,
  proxySessionReauthUrl,
  withProxySessionRecovery,
} from "./proxy-session"

const origin = "https://agent.example.test"
const page = `${origin}/server/abc/session/xyz?tab=2#bottom`
const attemptKey = "genixcode.fork.proxySession.attempt"

function opaqueRedirect() {
  const response = new Response(null, { status: 200 })
  Object.defineProperty(response, "type", { value: "opaqueredirect" })
  return response
}

function setup(input: {
  fail?: (url: URL) => unknown
  probe?: () => Promise<Response>
  hidden?: boolean
  storage?: Map<string, string> | null
  now?: number
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const navigations: string[] = []
  const events: string[] = []
  const visible: Array<() => void> = []
  const storage = input.storage === null ? undefined : (input.storage ?? new Map<string, string>())
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
  const deps: Parameters<typeof withProxySessionRecovery>[1] = {
    origin,
    href: () => page,
    navigate: (url) => {
      events.push("navigate")
      navigations.push(url)
    },
    unregisterServiceWorkers: async () => void events.push("unregister"),
    hidden: () => hidden,
    onVisible: (callback) => visible.push(callback),
    now: () => input.now ?? 1_000_000,
    storage: storage && {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
    },
    log: () => {},
  }
  const wrapped = withProxySessionRecovery(fetch, deps)
  // A second transport on the same page, as the app builds one per server context.
  const sibling = () => withProxySessionRecovery(fetch, deps)
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const show = () => {
    hidden = false
    for (const callback of visible.splice(0)) callback()
  }
  return { wrapped, sibling, calls, navigations, events, settle, show, storage }
}

const corsFailure = (url: URL) => (url.pathname === "/api/session" ? new TypeError("Failed to fetch") : undefined)
const probes = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.filter((call) => call.url.endsWith(PROXY_SESSION_PROBE_PATH))
const expired = { fail: corsFailure, probe: async () => opaqueRedirect() }

describe("withProxySessionRecovery", () => {
  test("passes successful requests through without probing", async () => {
    const input = setup({})
    const response = await input.wrapped(`${origin}/api/session`, { method: "POST" })
    expect(await response.text()).toBe("ok")
    expect(input.calls).toEqual([{ url: `${origin}/api/session`, init: { method: "POST" } }])
  })

  test("navigates past the service worker when a failure is explained by a redirecting proxy", async () => {
    const input = setup(expired)
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow("Failed to fetch")
    await input.settle()
    expect(probes(input.calls)).toHaveLength(1)
    expect(probes(input.calls)[0]!.init).toMatchObject({ redirect: "manual", cache: "no-store" })
    expect(input.events).toEqual(["navigate"])
    const target = new URL(input.navigations[0]!)
    expect(target.pathname).toBe("/server/abc/session/xyz")
    expect(target.searchParams.get("tab")).toBe("2")
    expect(target.searchParams.get(PROXY_SESSION_REAUTH_PARAM)).toBe("1")
    expect(target.hash).toBe("#bottom")
  })

  test("leaves the page alone when the server is simply unreachable", async () => {
    const input = setup({ fail: corsFailure, probe: async () => Promise.reject(new TypeError("Failed to fetch")) })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.navigations).toHaveLength(0)
  })

  test("leaves the page alone when the probe gets a normal answer", async () => {
    const input = setup({ fail: corsFailure })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(1)
    expect(input.navigations).toHaveLength(0)
  })

  test("shares one probe across a burst of failures and navigates once", async () => {
    const input = setup(expired)
    await Promise.allSettled([1, 2, 3].map(() => input.wrapped(`${origin}/api/session`)))
    await input.settle()
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(1)
    expect(input.navigations).toHaveLength(1)
  })

  test("signs in once per page even when several transports see the failure", async () => {
    const input = setup(expired)
    const other = input.sibling()
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    await expect(other(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(1)
    expect(input.events).toEqual(["navigate"])
  })

  test("does not probe for aborted or timed-out requests", async () => {
    const input = setup({
      ...expired,
      fail: (url) =>
        url.pathname === "/api/session" ? new DOMException("Timed out waiting", "TimeoutError") : undefined,
    })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(0)
  })

  test("ignores requests to other origins", async () => {
    const input = setup({ ...expired, fail: () => new TypeError("Failed to fetch") })
    await expect(input.wrapped("https://elsewhere.example.test/api/session")).rejects.toThrow()
    await input.settle()
    expect(probes(input.calls)).toHaveLength(0)
  })

  test("waits for a hidden tab to become visible before navigating", async () => {
    const input = setup({ ...expired, hidden: true })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.navigations).toHaveLength(0)
    input.show()
    await input.settle()
    expect(input.navigations).toHaveLength(1)
  })

  test("unregisters the service worker when the marked navigation did not help", async () => {
    const now = 1_000_000
    const storage = new Map([[attemptKey, `${now - 5_000}:navigate`]])
    const input = setup({ ...expired, storage, now })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.events).toEqual(["unregister", "navigate"])
    expect(storage.get(attemptKey)).toBe(`${now}:unregister`)
  })

  test("stops once both stages have been tried within the cooldown", async () => {
    const now = 1_000_000
    const storage = new Map([[attemptKey, `${now - 5_000}:unregister`]])
    const input = setup({ ...expired, storage, now })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.events).toEqual([])
  })

  test("starts over with a plain marked navigation once the cooldown has passed", async () => {
    const now = 1_000_000
    const storage = new Map([[attemptKey, `${now - PROXY_SESSION_RELOGIN_COOLDOWN_MS}:unregister`]])
    const input = setup({ ...expired, storage, now })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.events).toEqual(["navigate"])
  })

  test("does not navigate on its own without session storage", async () => {
    const input = setup({ ...expired, storage: null })
    await expect(input.wrapped(`${origin}/api/session`)).rejects.toThrow()
    await input.settle()
    expect(input.events).toEqual([])
  })
})

describe("the re-login marker", () => {
  test("is matched the way Workbox tests a navigation, path plus query", () => {
    const marked = new URL(proxySessionReauthUrl(page))
    expect(PROXY_SESSION_REAUTH_PATTERN.test(marked.pathname + marked.search)).toBe(true)
    expect(PROXY_SESSION_REAUTH_PATTERN.test("/?genixcode-reauth")).toBe(true)
    expect(PROXY_SESSION_REAUTH_PATTERN.test("/server/abc/session/xyz?tab=2")).toBe(false)
    expect(PROXY_SESSION_REAUTH_PATTERN.test("/?genixcode-reauthx=1")).toBe(false)
  })

  test("leaves the proxy's callback and the marker to the network, and nothing the app routes", () => {
    const denied = (path: string) => PROXY_SESSION_NAVIGATION_DENYLIST.some((pattern) => pattern.test(path))
    expect(denied("/cdn-cgi/access/authorized?token=abc&redirect=%2F")).toBe(true)
    expect(denied("/?genixcode-reauth=1")).toBe(true)
    expect(denied("/")).toBe(false)
    expect(denied("/server/abc/session/xyz")).toBe(false)
    expect(denied("/new-session?cdn-cgi=1")).toBe(false)
  })

  test("is on the service worker's navigateFallbackDenylist", async () => {
    // A rebase that takes upstream's vite.pwa.ts wholesale drops the entry, and
    // the re-login would quietly go back to being served from cache.
    const source = await readFile(fileURLToPath(new URL("../../vite.pwa.ts", import.meta.url)), "utf8")
    expect(source).toMatch(/navigateFallbackDenylist: \[[\s\S]{0,400}\.\.\.PROXY_SESSION_NAVIGATION_DENYLIST/)
  })
})
