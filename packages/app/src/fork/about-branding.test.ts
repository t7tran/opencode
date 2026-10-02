import { describe, expect, test } from "bun:test"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PRODUCT_NAME, rebrandDict } from "@opencode/util/fork/brand"
import { dict } from "@/runtime/i18n/en"

// Two brand surfaces in the desktop shell that the dictionary seam does not
// reach, plus the one screen the seam has to deliberately skip.
//
// The titlebar menu's group heading is a JSX literal, not a translated string,
// so `rebrandDict()` never sees it and upstream's "OpenCode" sat there in plain
// sight until it was replaced with PRODUCT_NAME. Same story as index.html and
// the PWA manifest in web-shell.test.ts: a rebase that takes upstream's file
// wholesale restores the wrong name without failing anything else.
//
// The About screen runs the other way. It is credits and attribution — it names
// upstream's authors, links upstream's site, and states whose registered
// trademark "OpenCode" is — so its copy has to survive the rename intact. The
// fork identifies itself there through the wordmark and one added line.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")

describe("titlebar menu heading", () => {
  test("carries the fork's product name rather than a hardcoded upstream one", async () => {
    const source = await Bun.file(join(app, "shell/titlebar/windows-menu.tsx")).text()
    expect(source).toContain('<Menu.GroupLabel class="desktop-app-menu-heading">{PRODUCT_NAME}</Menu.GroupLabel>')
    expect(PRODUCT_NAME).toBe("GenixCode")
  })
})

describe("about screen", () => {
  const about = rebrandDict(dict as unknown as Record<string, unknown>)

  test("keeps upstream's attribution copy exactly as upstream wrote it", () => {
    expect(about["settings.about.website"]).toBe("www.opencode.ai")
    expect(about["settings.about.description"]).toBe("OpenCode, the open source coding agent")
    expect(about["settings.about.trademark"]).toBe("OpenCode is a registered trademark of Anomaly Innovations, Inc.")
  })

  test("every settings.about key survives the seam untouched", () => {
    for (const [key, value] of Object.entries(dict)) {
      if (!key.startsWith("settings.about.")) continue
      expect(about[key]).toBe(value)
    }
  })

  test("the rest of the dictionary is still renamed", () => {
    expect(about["desktop.menu.app"]).toBe(PRODUCT_NAME)
  })

  test("the wordmark spells the fork's name", async () => {
    const source = await Bun.file(join(app, "settings/about/animated-wordmark.tsx")).text()
    const letters = source.match(/^const target = \[(.+)\] as const$/m)?.[1]
    expect(letters?.replaceAll(/[^a-z]/g, "")).toBe("genixcode")
  })
})
