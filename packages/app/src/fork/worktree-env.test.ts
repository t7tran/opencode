import { describe, expect, test } from "bun:test"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { rebrandDict } from "@opencode/util/fork/brand"
import { dict } from "@/runtime/i18n/en"

// The worktree startup script is handed two variables, and project settings
// tells the user their names. Core exports them as GENIXCODE_WORKTREE_*; the
// hint copy is still upstream's `$OPENCODE_WORKTREE_*` in every locale file, and
// only reads right because `rebrandDict()` rewrites OPENCODE → GENIXCODE on load.
//
// That makes two edits that each look harmless — a rebase restoring upstream's
// names in worktree.ts, or a carve-out in `rebrand()` that leaves env-var-shaped
// words alone — and either one leaves the hint naming a variable the script
// never receives. It reads as empty, not as an error.

const core = resolve(dirname(fileURLToPath(import.meta.url)), "../../../core/src")

describe("worktree startup variables", () => {
  test("core exports them under the fork's names", async () => {
    const source = await Bun.file(resolve(core, "worktree.ts")).text()
    expect(source).toContain("GENIXCODE_WORKTREE_BASE: sourceDirectory, // fork_change")
    expect(source).toContain("GENIXCODE_WORKTREE_PATH: result.directory, // fork_change")
    expect(source).not.toContain("OPENCODE_WORKTREE_")
  })

  test("the settings hints name the variables core exports", () => {
    const copy = rebrandDict(dict)
    expect(copy["project.settings.worktree.startup.hint.base"]).toContain("$GENIXCODE_WORKTREE_BASE")
    expect(copy["project.settings.worktree.startup.hint.new"]).toContain("$GENIXCODE_WORKTREE_PATH")
  })
})
