import { describe, expect, test } from "bun:test"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { personaFolder } from "./persona-folder"

// A folder whose config disables Build is a persona folder, and its new-session
// screen has no project or branch/workspace picker. See persona-folder.ts and
// FORK.md § Persona folders keep you in the folder.

// The server's v2 agent list, as data.location.agent.list() holds it.
const agent = (id: string, hidden = false) =>
  ({ id, mode: "primary", hidden, request: { settings: {}, headers: {}, body: {} }, permissions: [] }) as never

describe("personaFolder", () => {
  test("is false for an ordinary project, which has Build", () => {
    expect(personaFolder([agent("build"), agent("plan"), agent("general", true)])).toBe(false)
  })

  test("is false when only Plan is disabled", () => {
    expect(personaFolder([agent("build"), agent("general", true)])).toBe(false)
  })

  test("is true when Build is gone and the persona is the agent", () => {
    expect(personaFolder([agent("writer"), agent("general", true), agent("explore", true)])).toBe(true)
  })

  test("is true with pinned agents from other folders listed beside the persona", () => {
    expect(personaFolder([agent("writer"), agent("coder"), agent("general", true)])).toBe(true)
  })

  test("says nothing until the list has loaded", () => {
    expect(personaFolder(undefined)).toBe(false)
    expect(personaFolder([])).toBe(false)
  })

  test("reads a list already normalised to names", () => {
    expect(personaFolder([{ name: "build" }, { name: "plan" }] as never)).toBe(false)
    expect(personaFolder([{ name: "writer" }] as never)).toBe(true)
  })
})

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const read = (path: string) => Bun.file(resolve(app, path)).text()

// A rebase that takes upstream's copy of any of these files wholesale would
// quietly bring the pickers back. This is where that shows up.
describe("persona folder wiring", () => {
  test("the controller turns the branch/workspace bar off and exposes persona", async () => {
    const source = await read("src/new-session/workspace/controller.ts")
    expect(source).toContain(
      "const persona = createMemo(() => personaFolder(data.location.agent.list({ directory: sdk().directory })))",
    )
    expect(source).toContain("      !persona() &&\n      resolveNewSessionGit({")
    expect(source).toContain("data.location.agent.sync({ directory: sdk().directory }), // fork_change")
    expect(source).toContain("    persona, // fork_change")
  })

  test("the view hides the project and branch row", async () => {
    const source = await read("src/new-session/view.tsx")
    expect(source).toContain("<Show when={props.project.selected() && !props.workspace.persona() /* fork_change */}>")
  })

  test("the project picker shortcut is off", async () => {
    const source = await read("src/new-session/screen.tsx")
    expect(source).toContain("empty: () => project.empty() || workspace.persona(), // fork_change")
  })
})
