import { describe, expect, test } from "bun:test"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PRODUCT_NAME } from "@opencode/util/fork/brand"

// The web UI's shell — the document the CLI serves for `genixcode web` and
// `genixcode serve` — carries its brand outside the dictionary seam:
// `<title>` and the PWA manifest are static files, so `rebrandDict()` never
// sees them. Upstream writes "OpenCode" in both; these assertions are what
// stop a rebase from quietly restoring the browser tab and the installed-app
// name to upstream's product.
//
// Upstream v2 note: v1 served `public/site.webmanifest`, a symlink into the
// shared favicon assets in packages/ui. v2 generates the manifest at build time
// from `manifest.json` in this package (see vite.icons.ts), so that is the file
// the rename has to land in. packages/ui still carries its own copy for the
// sites that use it directly, and it is renamed too.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const ui = resolve(app, "../ui")

// A checkout with core.symlinks=false materialises a symlink as a plain file
// holding the relative target, so follow that by hand — the same thing
// script/check-fork-annotations.ts does.
async function read(path: string) {
  const body = await Bun.file(path).text()
  const target = body.trim()
  if (!target.startsWith("../")) return body
  return Bun.file(resolve(dirname(path), target)).text()
}

describe("web shell branding", () => {
  test("index.html titles the tab with the fork's product name", async () => {
    const html = await read(join(app, "index.html"))
    expect(html).toContain(`<title>${PRODUCT_NAME}</title>`)
    // Comments carry the markers recording what upstream wrote, and
    // %OPENCODE_*% are build-time placeholder tokens rather than user-visible
    // copy — identifiers, like the dictionary keys rebrandDict() leaves alone.
    const markup = html.replaceAll(/<!--[\s\S]*?-->/g, "").replaceAll(/%OPENCODE_[A-Z_]+%/g, "")
    expect(markup).not.toMatch(/opencode/i)
  })

  test("the generated web manifest names the installed app after the fork", async () => {
    const manifest = JSON.parse(await read(join(app, "manifest.json")))
    expect(manifest.name).toBe(PRODUCT_NAME)
    expect(manifest.short_name).toBe(PRODUCT_NAME)
  })

  test("the shared favicon manifest names the installed app after the fork", async () => {
    const manifest = JSON.parse(await read(join(ui, "src/assets/favicon/site.webmanifest")))
    expect(manifest.name).toBe(PRODUCT_NAME)
    expect(manifest.short_name).toBe(PRODUCT_NAME)
  })
})
