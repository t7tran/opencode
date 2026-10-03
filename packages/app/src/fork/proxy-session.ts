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
// there failing every call until someone presses reload. See FORK.md § Serving
// without authentication.
//
// So when a same-origin request fails at the network level, ask the server a
// cheap question with redirects turned off. An `opaqueredirect` answer means
// something in front of us wants the browser back on its login page, and the
// only thing that gets it there is a top-level reload. Anything else — the
// server is down, the laptop is offline — is left to the connection logic
// upstream already has.
//
// Requests are otherwise passed through untouched: no redirect mode, header or
// retry changes on the happy path, so upstream's behaviour holds everywhere a
// proxy is not involved. The desktop renderer never matches the same-origin
// check (its page is not served by the sidecar), so this is inert there.

// Served by the API, so the PWA's service worker never answers it from cache
// the way it would answer "/".
export const PROXY_SESSION_PROBE_PATH = "/api/info"

// A reload that lands back on a page whose API calls still redirect would
// otherwise loop as fast as the page can load.
export const PROXY_SESSION_RELOAD_COOLDOWN_MS = 60_000

const RELOADED_AT_KEY = "genixcode.fork.proxySession.reloadedAt"

type Deps = {
  origin: string
  reload: () => void
  hidden: () => boolean
  onVisible: (callback: () => void) => void
  now: () => number
  storage?: Pick<Storage, "getItem" | "setItem">
  log: (message: string, data: Record<string, unknown>) => void
}

function browserDeps(): Deps | undefined {
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
    reload: () => window.location.reload(),
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
  let probing: Promise<void> | undefined
  let scheduled = false

  const reload = () => {
    try {
      const last = Number(deps.storage?.getItem(RELOADED_AT_KEY) ?? 0)
      if (deps.now() - last < PROXY_SESSION_RELOAD_COOLDOWN_MS) {
        deps.log("session still redirecting after a reload; leaving the page alone", { last })
        return
      }
      deps.storage?.setItem(RELOADED_AT_KEY, String(deps.now()))
    } catch {
      // Storage blocked: lose the loop guard rather than the recovery.
    }
    deps.reload()
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    deps.log("proxy session expired; reloading to sign in again", { hidden: deps.hidden() })
    // A hidden tab gains nothing from reloading now, and the login provider may
    // want a click. Do it when the user comes back.
    if (deps.hidden()) deps.onVisible(reload)
    else reload()
  }

  const probe = () =>
    (probing ??= base(new URL(PROXY_SESSION_PROBE_PATH, deps.origin), {
      redirect: "manual",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => {
        if (response.type === "opaqueredirect") schedule()
      })
      .catch(() => {})
      .finally(() => {
        probing = undefined
      }))

  return Object.assign(
    (resource: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(resource, deps.origin)
      if (url?.origin !== deps.origin) return base(resource, init)
      return base(resource, init).catch((error: unknown) => {
        if (!scheduled && !isAbort(error)) void probe()
        throw error
      })
    },
    { preconnect: () => {} },
  )
}
