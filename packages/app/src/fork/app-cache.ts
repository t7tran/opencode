// fork_change - new file
//
// "Reload latest version": throw away the service worker's copy of the app and
// load it fresh from the server.
//
// The web UI's service worker keeps every open tab on the build it was loaded
// with, and only lets a newly downloaded build take over once every tab and
// installed-app window is closed. A reload doesn't count — the old page is still
// open while the new one is requested — so someone who keeps the agent open and
// just refreshes can stay on an old build for weeks, fixes and all. Getting off
// it took DevTools or the browser's site-data settings, neither of which most
// people have heard of. See FORK.md § Reloading the latest version.
//
// This does the same job from a button: unregister the worker, delete the
// caches it filled, and navigate to the current page. The navigation carries the
// proxy-session marker, so it reaches the network even if a worker somehow
// survives, and goes through the proxy's login if the session has also expired
// (proxy-session.ts). Drafts (IndexedDB), settings and layout (localStorage) and
// everything on the server are left alone.

import { proxySessionReauthUrl } from "./proxy-session"

type Deps = {
  serviceWorkers?: Pick<ServiceWorkerContainer, "getRegistrations">
  caches?: Pick<CacheStorage, "keys" | "delete">
  href: () => string
  navigate: (url: string) => void
  log: (message: string, data: Record<string, unknown>) => void
}

function browserDeps(): Deps {
  return {
    serviceWorkers:
      typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
    caches: typeof caches !== "undefined" ? caches : undefined,
    href: () => window.location.href,
    navigate: (url) => window.location.replace(url),
    log: (message, data) => console.warn(`[app-cache] ${message}`, data),
  }
}

/** True where there's a service worker to get rid of — the browser, not the desktop app. */
export function appCacheResetAvailable(platform: string) {
  return platform === "web" && typeof navigator !== "undefined" && "serviceWorker" in navigator
}

export async function reloadLatestVersion(deps: Deps = browserDeps()) {
  // Best effort at each step: whatever's left behind, the marked navigation
  // still goes to the network, so the page always comes back from the server.
  try {
    const registrations = (await deps.serviceWorkers?.getRegistrations()) ?? []
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch (error) {
    deps.log("could not unregister the service worker", { error: String(error) })
  }
  try {
    const keys = (await deps.caches?.keys()) ?? []
    await Promise.all(keys.map((key) => deps.caches!.delete(key)))
  } catch (error) {
    deps.log("could not clear the app cache", { error: String(error) })
  }
  deps.navigate(proxySessionReauthUrl(deps.href()))
}
