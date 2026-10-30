import { describe, expect, test } from "bun:test"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PRODUCT_NAME, UPSTREAM_PRODUCT_NAME } from "@opencode/util/fork/brand"

// Two more brand literals the dictionary seam cannot reach, for the same reason
// the titlebar heading in about-branding.test.ts cannot: neither of them ever
// was a dictionary value, so `rebrandDict()` never gets a look at either.
//
// The connect screen's wordmark is a `role="img"` with a hand-written
// `aria-label`. The wordmark it labels already draws "genixcode", so leaving the
// label as upstream wrote it told a screen reader one product name while the
// screen showed another.
//
// The theme picker's default entry is a plain object literal. Note there are two
// sources for it and only one of them wins: `name()` reads
// `store.themes[id]?.name` first, and `oc-2` is the one theme eagerly bundled
// into that store, so the `name` field inside `oc-2.json` shadows the `names`
// map entirely. Renaming the map alone would have looked like a fix and changed
// nothing on screen — hence the override at the import, and hence this test
// asserting upstream's JSON is still the thing being overridden.

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ui = resolve(src, "../../ui/src")

describe("connect screen wordmark", () => {
  test("labels the wordmark with the fork's product name", async () => {
    const source = await Bun.file(join(src, "servers/connect/screen.tsx")).text()
    expect(source).toContain('aria-label={PRODUCT_NAME /* fork_change */}')
    expect(source).not.toContain(`aria-label="${UPSTREAM_PRODUCT_NAME}"`)
    expect(PRODUCT_NAME).toBe("GenixCode")
  })
})

describe("default theme name", () => {
  test("the bundled oc-2 theme is renamed at the import, where name() reads it", async () => {
    const source = await Bun.file(join(ui, "theme/context.tsx")).text()
    expect(source).toContain("const oc2Theme = { ...(oc2ThemeJson as DesktopTheme), name: PRODUCT_NAME }")
    expect(source).toContain('"oc-2": PRODUCT_NAME,')
  })

  test("the literal in packages/ui matches the brand module it cannot import", async () => {
    const source = await Bun.file(join(ui, "theme/context.tsx")).text()
    const literal = source.match(/^const PRODUCT_NAME = "(.+)"$/m)?.[1]
    expect(literal).toBe(PRODUCT_NAME)
  })

  test("upstream's theme file still carries the name being overridden", async () => {
    const theme = JSON.parse(await Bun.file(join(ui, "theme/themes/oc-2.json")).text())
    expect(theme.id).toBe("oc-2")
    expect(theme.name).toBe(UPSTREAM_PRODUCT_NAME)
  })

  test("third-party themes keep the names their authors gave them", async () => {
    const source = await Bun.file(join(ui, "theme/context.tsx")).text()
    for (const name of ["Dracula", "Nord", "GitHub", "Vercel", "Tokyonight"]) expect(source).toContain(`"${name}"`)
  })
})
