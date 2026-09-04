import { describe, expect, test } from "bun:test"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PRODUCT_NAME } from "@opencode-ai/core/fork/brand"

// The web UI's shell — the document the CLI serves for `genixcode web` and
// `genixcode serve` — carries its brand outside the dictionary seam:
// `<title>` and the PWA manifest are static files, so `rebrandDict()` never
// sees them. Upstream writes "OpenCode" in both; these assertions are what
// stop a rebase from quietly restoring the browser tab and the installed-app
// name to upstream's product.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

// packages/app/public/site.webmanifest is a symlink into the shared favicon
// assets. A checkout with core.symlinks=false has it as a plain file holding
// the relative target, so follow that by hand — the same thing
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
    // Comments carry the markers recording what upstream wrote, so only the
    // markup itself has to be clean.
    expect(html.replaceAll(/<!--[\s\S]*?-->/g, "")).not.toMatch(/opencode/i)
  })

  test("the web manifest names the installed app after the fork", async () => {
    const manifest = JSON.parse(await read(join(app, "public/site.webmanifest")))
    expect(manifest.name).toBe(PRODUCT_NAME)
    expect(manifest.short_name).toBe(PRODUCT_NAME)
  })
})
