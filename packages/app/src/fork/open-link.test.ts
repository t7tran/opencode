import { describe, expect, test } from "bun:test"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { latestSession, openDeepLinkRoute, openRoute, parseOpenRequest, resolveOpenDirectory } from "./open-link"

// `/open?dir=…[&new=1]` and `genixcode://open?…` drop someone into a folder,
// resuming its newest session unless the link asks for a new one. See
// open-link.ts and FORK.md § Opening a folder from a link.

const home = "/home/node"

describe("parseOpenRequest", () => {
  test("reads the folder and resumes by default", () => {
    expect(parseOpenRequest({ dir: "~/agents/writer" })).toEqual({ dir: "~/agents/writer", fresh: false })
  })

  test("new=1, new=true and a bare new all ask for a new session", () => {
    for (const flag of ["1", "true", "TRUE", "yes", ""])
      expect(parseOpenRequest({ dir: "/srv", new: flag })?.fresh).toBe(true)
  })

  test("new=0 and new=false resume", () => {
    for (const flag of ["0", "false", "no"]) expect(parseOpenRequest({ dir: "/srv", new: flag })?.fresh).toBe(false)
  })

  test("takes the first of repeated parameters", () => {
    expect(parseOpenRequest({ dir: ["/a", "/b"], new: ["1", "0"] })).toEqual({ dir: "/a", fresh: true })
  })

  test("a missing or blank dir is no request at all", () => {
    expect(parseOpenRequest({})).toBeUndefined()
    expect(parseOpenRequest({ dir: "  " })).toBeUndefined()
  })
})

describe("resolveOpenDirectory", () => {
  test("expands ~ against the server's home", () => {
    expect(resolveOpenDirectory("~/agents/writer", home)).toBe("/home/node/agents/writer")
    expect(resolveOpenDirectory("~", home)).toBe(home)
    expect(resolveOpenDirectory("~/", `${home}/`)).toBe(home)
  })

  test("leaves absolute paths alone apart from a trailing slash", () => {
    expect(resolveOpenDirectory("/srv/agents/writer/", home)).toBe("/srv/agents/writer")
    expect(resolveOpenDirectory("/", home)).toBe("/")
  })

  test("handles Windows homes and paths", () => {
    expect(resolveOpenDirectory("~\\agents\\writer", "C:\\Users\\node")).toBe("C:\\Users\\node\\agents\\writer")
    expect(resolveOpenDirectory("~/agents", "C:\\Users\\node")).toBe("C:\\Users\\node\\agents")
    expect(resolveOpenDirectory("D:\\work\\", home)).toBe("D:\\work")
  })

  test("refuses what can't be an absolute folder", () => {
    expect(resolveOpenDirectory("~/agents", undefined)).toBeUndefined()
    expect(resolveOpenDirectory("~other/agents", home)).toBeUndefined()
    expect(resolveOpenDirectory("agents/writer", home)).toBeUndefined()
  })
})

describe("latestSession", () => {
  const dir = "/home/node/agents/writer"
  const session = (id: string, updated: number, extra: Record<string, unknown> = {}) => ({
    id,
    location: { directory: dir },
    time: { created: 0, updated },
    ...extra,
  })

  test("picks the most recently updated session in the folder", () => {
    expect(latestSession([session("a", 1), session("b", 3), session("c", 2)], dir)?.id).toBe("b")
  })

  test("only matches the folder itself, spelled with or without a trailing slash", () => {
    const sessions = [
      session("sub", 9, { location: { directory: `${dir}/drafts` } }),
      session("parent", 8, { location: { directory: "/home/node/agents" } }),
      session("here", 1, { location: { directory: `${dir}/` } }),
    ]
    expect(latestSession(sessions, dir)?.id).toBe("here")
  })

  test("skips subagent and archived sessions", () => {
    const sessions = [
      session("child", 9, { parentID: "x" }),
      session("archived", 8, { time: { created: 0, updated: 8, archived: 8 } }),
      session("live", 1),
    ]
    expect(latestSession(sessions, dir)?.id).toBe("live")
  })

  test("nothing to resume is undefined", () => {
    expect(latestSession([], dir)).toBeUndefined()
  })
})

describe("openDeepLinkRoute", () => {
  test("maps genixcode://open onto the /open route", () => {
    expect(openDeepLinkRoute("genixcode://open?dir=~/agents/writer")).toBe("/open?dir=%7E%2Fagents%2Fwriter")
    expect(openDeepLinkRoute("genixcode://open/?dir=/srv&new=1")).toBe("/open?dir=%2Fsrv&new=1")
    expect(openDeepLinkRoute("genixcode:open?dir=/srv")).toBe("/open?dir=%2Fsrv")
  })

  test("leaves other deep links and malformed ones alone", () => {
    expect(openDeepLinkRoute("genixcode://console/authorized?window=1")).toBeUndefined()
    expect(openDeepLinkRoute("genixcode://open/elsewhere?dir=/srv")).toBeUndefined()
    expect(openDeepLinkRoute("opencode://open?dir=/srv")).toBeUndefined()
    expect(openDeepLinkRoute("genixcode://open")).toBeUndefined()
    expect(openDeepLinkRoute("not a url")).toBeUndefined()
  })

  test("the route round-trips through parseOpenRequest", () => {
    const route = openRoute({ dir: "~/agents/a b&c", fresh: true })
    const params = new URL(route, "http://x").searchParams
    expect(parseOpenRequest({ dir: params.get("dir")!, new: params.get("new")! })).toEqual({
      dir: "~/agents/a b&c",
      fresh: true,
    })
  })
})

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

// A rebase that takes upstream's copy of any of these files wholesale would
// quietly turn the links off. This is where that shows up.
describe("open link wiring", () => {
  test("the router serves /open", async () => {
    const source = await Bun.file(resolve(app, "src/shell/routes/routes.tsx")).text()
    expect(source).toContain('<Route path="/open" component={OpenRoute /* fork_change */} />')
    const layout = await Bun.file(resolve(app, "src/shell/state/layout.tsx")).text()
    expect(layout).toContain('if (parts[0] === "open") return { type: "home" } // fork_change')
  })

  test("the desktop app listens for genixcode://open links", async () => {
    const exports = await Bun.file(resolve(app, "src/desktop.ts")).text()
    expect(exports).toContain('export { OpenDeepLinks } from "./fork/open-route" // fork_change')
    const desktop = await Bun.file(resolve(app, "../desktop/src/renderer/desktop-app.tsx")).text()
    expect(desktop).toContain("<OpenDeepLinks />")
  })

  test("the server reports its home folder for ~", async () => {
    const handler = await Bun.file(resolve(app, "../server/src/handlers/server.ts")).text()
    expect(handler).toContain("paths: { ...info.paths, home: Global.Path.home }, // fork_change")
  })
})
