import { describe, expect, test } from "bun:test"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { localSessionDirectory } from "./session-directory"

// A new session started on "Local repository" runs where its draft was opened,
// unless the draft is in a linked worktree — then it moves to the main checkout,
// as upstream intended. See session-directory.ts and FORK.md § Sessions start
// where the project was opened.

const main = "/home/node/agents"
const linked = "/home/node/.local/share/genixcode/worktree/056ccc/feature"

describe("localSessionDirectory", () => {
  test("keeps a subfolder of the main checkout", () => {
    expect(localSessionDirectory(`${main}/fox-spirit`, { directory: main, canonical: main })).toBe(`${main}/fox-spirit`)
  })

  test("keeps the main checkout's root", () => {
    expect(localSessionDirectory(main, { directory: main, canonical: main })).toBe(main)
  })

  test("moves a linked worktree draft to the main checkout", () => {
    expect(localSessionDirectory(linked, { directory: linked, canonical: main })).toBe(main)
  })

  test("moves a subfolder of a linked worktree to the main checkout's root", () => {
    expect(localSessionDirectory(`${linked}/fox-spirit`, { directory: linked, canonical: main })).toBe(main)
  })

  test("tells a linked worktree inside the repository from a subfolder", () => {
    const inside = `${main}/.worktrees/feature`
    expect(localSessionDirectory(inside, { directory: inside, canonical: main })).toBe(main)
  })

  test("keeps a folder outside version control", () => {
    const plain = "/home/node/notes"
    expect(localSessionDirectory(plain, { directory: plain, canonical: plain })).toBe(plain)
  })

  test("keeps the draft's directory until the location is known", () => {
    expect(localSessionDirectory(`${main}/fox-spirit`, undefined)).toBe(`${main}/fox-spirit`)
  })

  test("compares checkouts the way the rest of the app compares paths", () => {
    expect(localSessionDirectory(`${main}/fox-spirit`, { directory: `${main}/`, canonical: main })).toBe(`${main}/fox-spirit`)
    expect(localSessionDirectory("C:\\repo\\pkg", { directory: "C:\\repo", canonical: "c:/repo" })).toBe("C:\\repo\\pkg")
  })
})

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const desktop = resolve(app, "../desktop")

describe("new session wiring", () => {
  // A rebase that takes upstream's composer-adapter.ts wholesale would silently
  // send every web and desktop session back to the repository root.
  test("Local repository resolves through the fork's rule", async () => {
    const source = await Bun.file(resolve(app, "src/new-session/composer-adapter.ts")).text()
    expect(source).toContain('import { localSessionDirectory } from "@/fork/session-directory" // fork_change')
    expect(source).toContain(
      "const localDirectory = localSessionDirectory(currentDirectory, data.location.info({ directory: currentDirectory })?.project) // fork_change",
    )
    expect(source).toContain('if (input.worktree === "main") return input.localDirectory // fork_change')
  })

  // The web UI and the desktop renderer share this package's new-session page,
  // so the rule covers both — as long as no other path creates sessions. One
  // added upstream would bypass it; this is where that shows up.
  test("the new-session composer is the only place either app creates a session", async () => {
    const callers = await Promise.all(
      [app, desktop].map(async (root) =>
        Array.fromAsync(new Bun.Glob("src/**/*.{ts,tsx}").scan({ cwd: root, absolute: true })),
      ),
    )
    const creators = await Promise.all(
      callers
        .flat()
        .filter((file) => !/\.test\.tsx?$/.test(file))
        .map(async (file) => ((await Bun.file(file).text()).match(/\bsession\.create\(/) ? relative(app, file) : undefined)),
    )
    expect(creators.filter((file) => file !== undefined)).toEqual(["src/new-session/composer-adapter.ts"])
  })
})
