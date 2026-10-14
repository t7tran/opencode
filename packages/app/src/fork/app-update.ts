// fork_change - new file
//
// "A new version is ready" — the web UI's update banner.
//
// The service worker parks every newly downloaded build until all of the
// origin's tabs and installed-app windows close, and a reload doesn't count
// (FORK.md § Reloading the latest version). Upstream registers the worker with
// a prompt in mind (registerType "prompt", and the generated sw.js answers a
// SKIP_WAITING message) but never shows one, so in practice a tab that stays
// open stays on its build. This is that prompt, as a persistent toast.
//
// Three things make it work for a tab that's open for days:
//
// - It looks for a waiting build at start, and listens for one finishing its
//   download while the tab is open.
// - It asks for update checks itself. The browser only checks on navigation,
//   and a single-page app left open never navigates, so without this a nightly
//   server upgrade wouldn't even be downloaded.
// - Reload hands over properly: SKIP_WAITING to the waiting worker, reload once
//   it controls the page. If it never takes over, fall back to the Settings
//   button's reset (app-cache.ts), which doesn't depend on the worker at all.
//
// If another tab applies the update, this one is now controlled by a worker
// whose cache doesn't hold the build it's running, so it gets the same banner
// and a plain reload.

import { showToast } from "@/shell/notifications/toast"
import { reloadLatestVersion } from "./app-cache"

export const APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60_000
// Coming back to the tab checks too, but not more often than this.
export const APP_UPDATE_VISIBLE_CHECK_GAP_MS = 10 * 60_000
export const APP_UPDATE_ACTIVATE_TIMEOUT_MS = 5_000

type Worker = {
  readonly state: string
  postMessage(message: unknown): void
  addEventListener(type: "statechange", listener: () => void): void
}
type Registration = {
  readonly waiting: Worker | null
  readonly installing: Worker | null
  update(): Promise<unknown>
  addEventListener(type: "updatefound", listener: () => void): void
}
type Container = {
  readonly ready: Promise<Registration>
  readonly controller: unknown
  addEventListener(type: "controllerchange", listener: () => void, options?: { once?: boolean }): void
}

type Deps = {
  container: Container
  show: (reload: () => void) => void
  reload: () => void
  fallback: () => Promise<void>
  now: () => number
  every: (ms: number, callback: () => void) => void
  after: (ms: number, callback: () => void) => void
  onVisible: (callback: () => void) => void
  log: (message: string, data: Record<string, unknown>) => void
}

function browserDeps(): Deps | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  return {
    container: navigator.serviceWorker as unknown as Container,
    show: (reload) =>
      showToast({
        title: "A new version of GenixCode is ready",
        description: "Reload to start using it. Your sessions and drafts are kept.",
        persistent: true,
        actions: [
          { label: "Reload", onClick: reload },
          { label: "Later", onClick: "dismiss" },
        ],
      }),
    reload: () => window.location.reload(),
    fallback: () => reloadLatestVersion(),
    now: Date.now,
    every: (ms, callback) => void setInterval(callback, ms),
    after: (ms, callback) => void setTimeout(callback, ms),
    onVisible: (callback) =>
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") callback()
      }),
    log: (message, data) => console.info(`[app-update] ${message}`, data),
  }
}

export async function watchForAppUpdates(deps: Deps | undefined = browserDeps()) {
  if (!deps) return
  const registration = await deps.container.ready
  let offered: unknown
  let applying = false
  let checked = deps.now()

  const apply = (worker: Worker) => {
    if (applying) return
    applying = true
    let done = false
    deps.container.addEventListener(
      "controllerchange",
      () => {
        if (done) return
        done = true
        deps.reload()
      },
      { once: true },
    )
    deps.after(APP_UPDATE_ACTIVATE_TIMEOUT_MS, () => {
      if (done) return
      done = true
      deps.log("the new version didn't take over; reloading without the cache", {})
      void deps.fallback()
    })
    worker.postMessage({ type: "SKIP_WAITING" })
  }

  // A tab that has no controller is running straight from the network (a first
  // visit, or a hard reload), so there's nothing stale to replace.
  const offer = (worker: Worker) => {
    if (offered === worker || !deps.container.controller) return
    offered = worker
    deps.log("a new version is waiting", {})
    deps.show(() => apply(worker))
  }

  if (registration.waiting) offer(registration.waiting)

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing
    if (!worker) return
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker)
    })
  })

  deps.container.addEventListener("controllerchange", () => {
    if (applying || offered === "stale") return
    offered = "stale"
    deps.log("another tab updated the app", {})
    deps.show(() => deps.reload())
  })

  const check = () => {
    checked = deps.now()
    // Behind an expired proxy session this is redirected and rejects; the
    // proxy-session recovery deals with that, so stay quiet here.
    registration.update().catch(() => {})
  }
  deps.every(APP_UPDATE_CHECK_INTERVAL_MS, check)
  deps.onVisible(() => {
    if (deps.now() - checked >= APP_UPDATE_VISIBLE_CHECK_GAP_MS) check()
  })
}
