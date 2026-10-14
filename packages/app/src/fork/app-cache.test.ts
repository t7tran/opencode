import { describe, expect, test } from "bun:test"
import { reloadLatestVersion } from "./app-cache"
import { PROXY_SESSION_REAUTH_PARAM } from "./proxy-session"

const page = "https://agent.example.test/server/abc/session/xyz?tab=2#bottom"

function setup(input?: { registrations?: number; caches?: string[]; failUnregister?: boolean; failCaches?: boolean }) {
  const events: string[] = []
  const navigations: string[] = []
  const registrations = Array.from({ length: input?.registrations ?? 1 }, (_, index) => ({
    unregister: async () => {
      if (input?.failUnregister) throw new Error("nope")
      events.push(`unregister:${index}`)
      return true
    },
  }))
  const keys = input?.caches ?? ["workbox-precache-v2-https://agent.example.test/"]
  const deps: Parameters<typeof reloadLatestVersion>[0] = {
    serviceWorkers: { getRegistrations: async () => registrations as unknown as ServiceWorkerRegistration[] },
    caches: {
      keys: async () => {
        if (input?.failCaches) throw new Error("blocked")
        return keys
      },
      delete: async (key: string) => {
        events.push(`delete:${key}`)
        return true
      },
    },
    href: () => page,
    navigate: (url) => {
      events.push("navigate")
      navigations.push(url)
    },
    log: () => {},
  }
  return { deps, events, navigations }
}

describe("reloadLatestVersion", () => {
  test("unregisters every worker and deletes every cache before navigating", async () => {
    const input = setup({ registrations: 2, caches: ["a", "b"] })
    await reloadLatestVersion(input.deps)
    expect(input.events.slice(0, 4).sort()).toEqual(["delete:a", "delete:b", "unregister:0", "unregister:1"])
    expect(input.events.at(-1)).toBe("navigate")
  })

  test("comes back to the same page, past the service worker and any proxy login", async () => {
    const input = setup()
    await reloadLatestVersion(input.deps)
    const target = new URL(input.navigations[0]!)
    expect(target.pathname).toBe("/server/abc/session/xyz")
    expect(target.searchParams.get("tab")).toBe("2")
    expect(target.searchParams.get(PROXY_SESSION_REAUTH_PARAM)).toBe("1")
    expect(target.hash).toBe("#bottom")
  })

  test("still navigates when unregistering or clearing fails", async () => {
    const input = setup({ failUnregister: true, failCaches: true })
    await reloadLatestVersion(input.deps)
    expect(input.navigations).toHaveLength(1)
  })

  test("still navigates where there's no service worker or cache storage at all", async () => {
    const input = setup()
    await reloadLatestVersion({ ...input.deps, serviceWorkers: undefined, caches: undefined })
    expect(input.navigations).toHaveLength(1)
  })
})
