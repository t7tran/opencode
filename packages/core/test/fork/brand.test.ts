// fork_change - new file
//
// Tests for the fork brand module. Verifies:
//   1. The packaging identity derived per channel (app id, product name, package name).
//   2. rebrand() rewrites upstream's product name in every casing we ship.
//   3. rebrandDict() rewrites values only — never keys — and preserves identity
//      when nothing matched.

import { describe, expect, test } from "bun:test"
import {
  APP_ID_BASE,
  BRAND_COLOR,
  CLI_NAME,
  PRODUCT_NAME,
  appId,
  packageName,
  productName,
  rebrand,
  rebrandDict,
  resolveChannel,
} from "../../src/fork/brand"

describe("channel identity", () => {
  test("app ids are suffixed for pre-release channels only", () => {
    expect(appId("prod")).toBe(APP_ID_BASE)
    expect(appId("beta")).toBe(`${APP_ID_BASE}.beta`)
    expect(appId("dev")).toBe(`${APP_ID_BASE}.dev`)
  })

  test("product names are title-cased per channel", () => {
    expect(productName("prod")).toBe("GenixCode")
    expect(productName("beta")).toBe("GenixCode Beta")
    expect(productName("dev")).toBe("GenixCode Dev")
  })

  test("linux package names follow the CLI name", () => {
    expect(packageName("prod")).toBe("genixcode")
    expect(packageName("beta")).toBe("genixcode-beta")
  })

  test("resolveChannel maps upstream's 'latest' onto prod and defaults to dev", () => {
    expect(resolveChannel("latest")).toBe("prod")
    expect(resolveChannel("beta")).toBe("beta")
    expect(resolveChannel(undefined)).toBe("dev")
    expect(resolveChannel("nonsense")).toBe("dev")
  })

  test("no upstream identity survives in the constants", () => {
    for (const value of [APP_ID_BASE, PRODUCT_NAME, CLI_NAME]) {
      expect(value.toLowerCase()).not.toContain("opencode")
    }
    expect(BRAND_COLOR).toBe("#0186CD")
  })
})

describe("rebrand", () => {
  test("rewrites each casing we ship", () => {
    expect(rebrand("Welcome to OpenCode")).toBe("Welcome to GenixCode")
    expect(rebrand("run the 'opencode' command")).toBe("run the 'genixcode' command")
    expect(rebrand("Opencode window")).toBe("Genixcode window")
    expect(rebrand("OPENCODE")).toBe("GENIXCODE")
  })

  test("collapses upstream's hosted services rather than renaming them", () => {
    expect(rebrand("OpenCode Zen gives you access")).toBe("Genix gives you access")
    expect(rebrand("Subscribe to OpenCode Go for $10/month")).toBe("Subscribe to Genix for $10/month")
  })

  test("rewrites every occurrence in a string", () => {
    expect(rebrand("OpenCode updated OpenCode")).toBe("GenixCode updated GenixCode")
  })

  test("leaves unrelated copy alone", () => {
    expect(rebrand("Toggle Sidebar")).toBe("Toggle Sidebar")
  })
})

describe("rebrandDict", () => {
  test("rewrites values and leaves keys untouched", () => {
    const out = rebrandDict({
      "dialog.provider.opencode.note": "Connect OpenCode",
      "desktop.menu.app": "OpenCode",
    })
    expect(out["dialog.provider.opencode.note"]).toBe("Connect GenixCode")
    expect(out["desktop.menu.app"]).toBe("GenixCode")
    expect(Object.keys(out)).toContain("dialog.provider.opencode.note")
  })

  test("returns the same reference when nothing matched", () => {
    const input = { "desktop.menu.file": "File" }
    expect(rebrandDict(input)).toBe(input)
  })

  test("passes non-string values through", () => {
    const out = rebrandDict({ count: 3, label: "OpenCode" } as Record<string, unknown>)
    expect(out.count).toBe(3)
    expect(out.label).toBe("GenixCode")
  })
})
