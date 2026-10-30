// fork_change - new file
//
// Recovering from an expired proxy session.
//
// `genixcode-cli serve --no-auth` is meant to sit behind something that has
// already logged the user in — a Cloudflare Access application, Kong's OIDC
// plugin. Those hand the browser a session cookie with a fixed lifetime, and
// once it runs out they answer every request with a redirect to their login
// page. A page navigation follows that happily and comes back logged in. A
// `fetch` from this single-page app does not: it follows the redirect to the
// login host, the login host sends no CORS headers, and the browser reports a
// bare network error. The UI never navigates again on its own, so it just sits
// there failing every call. See FORK.md § When the proxy's session runs out.
//
// So when a same-origin request fails at the network level, ask the server a
// cheap question with redirects turned off. An `opaqueredirect` answer means
// something in front of us wants the browser back on its login page, and the
// only thing that gets it there is a top-level navigation. Anything else — the
// server is down, the laptop is offline — is left to the connection logic
// upstream already has.
//
// That navigation can't be a plain `location.reload()`. The PWA's service
// worker answers every navigation from its precached `index.html`, so a reload
// never leaves the browser: the proxy never gets to redirect, the cookie stays
// dead, and the freshly loaded app fails exactly as before. Instead the page
// navigates to its own URL with PROXY_SESSION_REAUTH_PARAM added, and both that
// marker and the proxy's own callback path are on the service worker's
// navigateFallbackDenylist (PROXY_SESSION_NAVIGATION_DENYLIST), so the whole
// round trip — out to the login and back through the callback — hits the
// network.
//
// A tab still controlled by a worker built before that denylist entry existed
// would serve the marked URL from cache too. If the marked navigation lands
// back on a page whose API calls still redirect, the second attempt unregisters
// the service workers first. The worker re-registers on the next load.
//
// Requests are otherwise passed through untouched: no redirect mode, header or
// retry changes on the happy path, so upstream's behaviour holds everywhere a
// proxy is not involved. The desktop renderer never matches the same-origin
// check (its page is not served by the sidecar), so this is inert there.

// Served by the API, so the PWA's service worker never answers it from cache
// the way it would answer "/".
export const PROXY_SESSION_PROBE_PATH = "/api/info"

// Added to the URL of the re-login navigation; the service worker lets any
// navigation carrying it through to the network. Removed again on load.
export const PROXY_SESSION_REAUTH_PARAM = "genixcode-reauth"

// Workbox tests navigateFallbackDenylist against path + query.
export const PROXY_SESSION_REAUTH_PATTERN = /[?&]genixcode-reauth(?:[=&]|$)/

// Navigations the service worker must leave to the network, spread into
// navigateFallbackDenylist in `vite.pwa.ts`. The marker gets the browser out
// to the proxy. `/cdn-cgi/` is how it gets back: Cloudflare finishes a login by
// redirecting to `/cdn-cgi/access/authorized` on the app's own host, which sets
// the app's cookie — and that redirect hop is a navigation the worker would
// otherwise answer with the cached index.html, so the cookie never lands.
// Cloudflare reserves the prefix on every proxied host; the app never uses it.
export const PROXY_SESSION_NAVIGATION_DENYLIST = [/^\/cdn-cgi\//, PROXY_SESSION_REAUTH_PATTERN]

// Attempts closer together than this count as the same episode: the previous
// navigation didn't fix it, so escalate, and after the last stage stop rather
// than loop as fast as the page can load.
export const PROXY_SESSION_RELOGIN_COOLDOWN_MS = 60_000

const ATTEMPT_KEY = "genixcode.fork.proxySession.attempt"

type Stage = "navigate" | "unregister"

type Deps = {
  origin: string
  href: () => string
  navigate: (url: string) => void
  unregisterServiceWorkers: () => Promise<void>
  hidden: () => boolean
  onVisible: (callback: () => void) => void
  now: () => number
  storage?: Pick<Storage, "getItem" | "setItem">
  log: (message: string, data: Record<string, unknown>) => void
}

// The page builds more than one transport (one per server context), each with
// its own wrapped fetch. They must share one re-login per page load, or the
// second would read the first's attempt as one that already failed.
type State = { probing?: Promise<void>; scheduled: boolean }
const states = new WeakMap<Deps, State>()
let browser: Deps | undefined

function browserDeps(): Deps | undefined {
  browser ??= createBrowserDeps()
  return browser
}

function createBrowserDeps(): Deps | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return
  const origin = window.location?.origin
  if (!origin || origin === "null") return
  let storage: Deps["storage"]
  try {
    storage = window.sessionStorage
  } catch {
    storage = undefined
  }
  return {
    origin,
    href: () => window.location.href,
    navigate: (url) => window.location.replace(url),
    async unregisterServiceWorkers() {
      if (!("serviceWorker" in navigator)) return
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    },
    hidden: () => document.visibilityState === "hidden",
    onVisible(callback) {
      const listener = () => {
        if (document.visibilityState === "hidden") return
        document.removeEventListener("visibilitychange", listener)
        callback()
      }
      document.addEventListener("visibilitychange", listener)
    },
    now: Date.now,
    storage,
    log: (message, data) => console.warn(`[proxy-session] ${message}`, data),
  }
}

export function proxySessionReauthUrl(href: string) {
  const url = new URL(href)
  url.searchParams.set(PROXY_SESSION_REAUTH_PARAM, "1")
  return url.href
}

/** Drops the re-login marker from the address bar once the page has loaded. */
export function clearProxySessionMarker() {
  if (typeof location === "undefined" || typeof history === "undefined") return
  const url = new URL(location.href)
  if (!url.searchParams.has(PROXY_SESSION_REAUTH_PARAM)) return
  url.searchParams.delete(PROXY_SESSION_REAUTH_PARAM)
  history.replaceState(history.state, "", url.pathname + url.search + url.hash)
}

function readAttempt(storage: NonNullable<Deps["storage"]>) {
  const raw = storage.getItem(ATTEMPT_KEY)
  if (!raw) return
  const [at, stage] = raw.split(":")
  return { at: Number(at), stage: stage as Stage }
}

function requestUrl(resource: RequestInfo | URL, origin: string) {
  try {
    if (resource instanceof Request) return new URL(resource.url)
    return new URL(resource instanceof URL ? resource.href : resource, origin)
  } catch {
    return undefined
  }
}

function isAbort(error: unknown) {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
}

export function withProxySessionRecovery(
  fetch: typeof globalThis.fetch,
  deps: Deps | undefined = browserDeps(),
): typeof globalThis.fetch {
  if (!deps) return fetch
  const base = fetch
  const state = states.get(deps) ?? { scheduled: false }
  states.set(deps, state)

  const relogin = async () => {
    // Without storage there's no way to tell a fresh expiry from a loop, so
    // don't navigate on our own at all.
    const storage = deps.storage
    if (!storage) {
      deps.log("proxy session expired, but session storage is unavailable; reload to sign in again", {})
      return
    }
    try {
      const last = readAttempt(storage)
      const recent = last !== undefined && deps.now() - last.at < PROXY_SESSION_RELOGIN_COOLDOWN_MS
      const stage: Stage | undefined = !recent ? "navigate" : last.stage === "navigate" ? "unregister" : undefined
      if (!stage) {
        deps.log("session still redirecting after signing in again; leaving the page alone", { last })
        return
      }
      storage.setItem(ATTEMPT_KEY, `${deps.now()}:${stage}`)
      if (stage === "unregister") {
        deps.log("still redirecting after a re-login; bypassing the service worker", {})
        await deps.unregisterServiceWorkers().catch(() => {})
      }
      deps.navigate(proxySessionReauthUrl(deps.href()))
    } catch (error) {
      deps.log("could not start the re-login", { error: String(error) })
    }
  }

  const schedule = () => {
    if (state.scheduled) return
    state.scheduled = true
    deps.log("proxy session expired; signing in again", { hidden: deps.hidden() })
    // A hidden tab gains nothing from navigating now, and the login provider may
    // want a click. Do it when the user comes back.
    if (deps.hidden()) deps.onVisible(() => void relogin())
    else void relogin()
  }

  const probe = () =>
    (state.probing ??= base(new URL(PROXY_SESSION_PROBE_PATH, deps.origin), {
      redirect: "manual",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => {
        if (response.type === "opaqueredirect") schedule()
      })
      .catch(() => {})
      .finally(() => {
        state.probing = undefined
      }))

  return Object.assign(
    (resource: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(resource, deps.origin)
      if (url?.origin !== deps.origin) return base(resource, init)
      return base(resource, init).catch((error: unknown) => {
        if (!state.scheduled && !isAbort(error)) void probe()
        throw error
      })
    },
    { preconnect: () => {} },
  )
}
