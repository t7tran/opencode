import { describe, expect, test } from "bun:test"
import {
  APP_UPDATE_ACTIVATE_TIMEOUT_MS,
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_VISIBLE_CHECK_GAP_MS,
  watchForAppUpdates,
} from "./app-update"

function worker(state: ServiceWorkerState = "installed") {
  const listeners: Array<() => void> = []
  const messages: unknown[] = []
  return {
    state,
    messages,
    postMessage: (message: unknown) => void messages.push(message),
    addEventListener: (_type: string, listener: () => void) => void listeners.push(listener),
    become(next: ServiceWorkerState) {
      this.state = next
      for (const listener of listeners) listener()
    },
  }
}
type FakeWorker = ReturnType<typeof worker>

function setup(input?: { waiting?: FakeWorker; controlled?: boolean; updateFails?: boolean }) {
  const shown: Array<() => void> = []
  const events: string[] = []
  const timers: Array<{ ms: number; callback: () => void; repeat: boolean }> = []
  const visible: Array<() => void> = []
  const updateFound: Array<() => void> = []
  let changeListeners: Array<{ listener: () => void; once: boolean }> = []
  let clock = 0
  const registration = {
    waiting: (input?.waiting ?? null) as FakeWorker | null,
    installing: null as FakeWorker | null,
    updates: 0,
    update() {
      this.updates++
      return input?.updateFails ? Promise.reject(new TypeError("redirected")) : Promise.resolve()
    },
    addEventListener: (_type: "updatefound", listener: () => void) => void updateFound.push(listener),
  }
  const container = {
    ready: Promise.resolve(registration),
    controller: input?.controlled === false ? null : {},
    addEventListener(_type: "controllerchange", listener: () => void, options?: { once?: boolean }) {
      changeListeners.push({ listener, once: !!options?.once })
    },
  }
  const started = watchForAppUpdates({
    container,
    show: (reload) => void shown.push(reload),
    reload: () => void events.push("reload"),
    fallback: async () => void events.push("fallback"),
    now: () => clock,
    every: (ms, callback) => void timers.push({ ms, callback, repeat: true }),
    after: (ms, callback) => void timers.push({ ms, callback, repeat: false }),
    onVisible: (callback) => void visible.push(callback),
    log: () => {},
  })
  return {
    started,
    registration,
    shown,
    events,
    timers,
    tick: (ms: number) => (clock += ms),
    showTab: () => visible.forEach((callback) => callback()),
    controllerChange() {
      const current = changeListeners
      changeListeners = current.filter((item) => !item.once)
      for (const item of current) item.listener()
    },
    downloadUpdate(next: FakeWorker) {
      registration.installing = next
      updateFound.forEach((listener) => listener())
    },
  }
}

describe("watchForAppUpdates", () => {
  test("offers a build that was already waiting when the page loaded", async () => {
    const input = setup({ waiting: worker() })
    await input.started
    expect(input.shown).toHaveLength(1)
  })

  test("says nothing when there's no new build", async () => {
    const input = setup()
    await input.started
    expect(input.shown).toHaveLength(0)
  })

  test("says nothing on a page the worker doesn't control", async () => {
    const input = setup({ waiting: worker(), controlled: false })
    await input.started
    expect(input.shown).toHaveLength(0)
  })

  test("offers a build that finishes downloading while the tab is open, once", async () => {
    const input = setup()
    await input.started
    const next = worker("installing")
    input.downloadUpdate(next)
    expect(input.shown).toHaveLength(0)
    next.become("installed")
    next.become("installed")
    expect(input.shown).toHaveLength(1)
  })

  test("Reload hands over to the waiting worker and reloads once it's in control", async () => {
    const waiting = worker()
    const input = setup({ waiting })
    await input.started
    input.shown[0]!()
    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }])
    expect(input.events).toEqual([])
    input.controllerChange()
    expect(input.events).toEqual(["reload"])
    input.timers.find((timer) => timer.ms === APP_UPDATE_ACTIVATE_TIMEOUT_MS)!.callback()
    expect(input.events).toEqual(["reload"])
    expect(input.shown).toHaveLength(1)
  })

  test("falls back to the full reset when the worker never takes over", async () => {
    const input = setup({ waiting: worker() })
    await input.started
    input.shown[0]!()
    input.timers.find((timer) => timer.ms === APP_UPDATE_ACTIVATE_TIMEOUT_MS)!.callback()
    expect(input.events).toEqual(["fallback"])
  })

  test("offers a plain reload when another tab applied the update", async () => {
    const input = setup()
    await input.started
    input.controllerChange()
    input.controllerChange()
    expect(input.shown).toHaveLength(1)
    input.shown[0]!()
    expect(input.events).toEqual(["reload"])
  })

  test("checks for updates on a timer and when the tab comes back after a while", async () => {
    const input = setup({ updateFails: true })
    await input.started
    const poll = input.timers.find((timer) => timer.repeat)!
    expect(poll.ms).toBe(APP_UPDATE_CHECK_INTERVAL_MS)
    poll.callback()
    expect(input.registration.updates).toBe(1)
    input.showTab()
    expect(input.registration.updates).toBe(1)
    input.tick(APP_UPDATE_VISIBLE_CHECK_GAP_MS)
    input.showTab()
    expect(input.registration.updates).toBe(2)
  })
})
