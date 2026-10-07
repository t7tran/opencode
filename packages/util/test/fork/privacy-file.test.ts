// fork_change - new file
//
// The administrator's privacy file (src/fork/privacy-file.ts) and the
// organisation instructions file (src/fork/org-instructions.ts).

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parsePrivacy, privacyPolicy } from "../../src/fork/privacy-file.js"
import { orgInstructions, renderOrgInstructions } from "../../src/fork/org-instructions.js"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-privacy-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

// mtime granularity can make two writes in one tick look identical to the cache.
function write(file: string, text: string) {
  fs.writeFileSync(file, text)
  const later = new Date(Date.now() + Math.floor(Math.random() * 100_000))
  fs.utimesSync(file, later, later)
}

describe("parsePrivacy", () => {
  test("every keyword, comments and blank lines", () => {
    const policy = parsePrivacy(
      [
        "# a comment",
        "",
        "secret   value#with-a-hash",
        "pattern  /ACME-\\d+/i   # trailing comment",
        "host     *.corp.example.com",
        "keep-env GH_TOKEN",
      ].join("\n"),
    )
    expect(policy.secrets).toEqual(["value#with-a-hash"])
    expect(policy.patterns.map((p) => [p.source, p.flags])).toEqual([["ACME-\\d+", "gi"]])
    expect(policy.hosts).toEqual(["*.corp.example.com"])
    expect([...policy.keepEnv]).toEqual(["GH_TOKEN"])
    expect(policy.errors).toEqual([])
  })

  test("reports bad lines without dropping good ones", () => {
    const policy = parsePrivacy(["bogus thing", "pattern not-a-regex", "pattern /(/", "keep-env", "host ok.example"].join("\n"))
    expect(policy.hosts).toEqual(["ok.example"])
    expect(policy.errors).toHaveLength(4)
  })
})

describe("privacyPolicy", () => {
  test("no file is absent, so the guard is a no-op", () => {
    const policy = privacyPolicy(path.join(dir, "absent"))
    expect(policy.absent).toBe(true)
    expect(policy.unreadable).toBe(false)
    expect(policy.secrets).toEqual([])
  })

  test("a missing directory on the way is absent too", () => {
    const file = path.join(dir, "not-a-dir")
    write(file, "")
    expect(privacyPolicy(path.join(file, "genixcode.privacy")).absent).toBe(true)
  })

  test("an empty file is present", () => {
    const file = path.join(dir, "genixcode.privacy")
    write(file, "")
    const policy = privacyPolicy(file)
    expect(policy.absent).toBe(false)
    expect(policy.unreadable).toBe(false)
  })

  test("reloads when the file changes", () => {
    const file = path.join(dir, "genixcode.privacy")
    write(file, "host a.example")
    expect(privacyPolicy(file).hosts).toEqual(["a.example"])
    write(file, "host b.example")
    expect(privacyPolicy(file).hosts).toEqual(["b.example"])
  })

  test.skipIf(process.getuid?.() === 0)("an unreadable file fails closed", () => {
    const file = path.join(dir, "genixcode.privacy")
    write(file, "keep-env GH_TOKEN")
    fs.chmodSync(file, 0o000)
    const policy = privacyPolicy(file)
    expect(policy.unreadable).toBe(true)
    expect(policy.keepEnv.size).toBe(0)
  })
})

describe("orgInstructions", () => {
  test("absent, blank and present", () => {
    const file = path.join(dir, "genixcode.instructions.md")
    expect(orgInstructions(file)).toEqual({ status: "absent" })
    write(file, "   \n")
    expect(orgInstructions(file)).toEqual({ status: "absent" })
    write(file, "- Always use Australian English.\n")
    expect(orgInstructions(file)).toEqual({ status: "present", text: "- Always use Australian English." })
  })

  test("a missing directory on the way is absent", () => {
    const file = path.join(dir, "not-a-dir")
    write(file, "")
    expect(orgInstructions(path.join(file, "genixcode.instructions.md"))).toEqual({ status: "absent" })
  })

  test.skipIf(process.getuid?.() === 0)("unreadable", () => {
    const file = path.join(dir, "genixcode.instructions.md")
    write(file, "rules")
    fs.chmodSync(file, 0o000)
    expect(orgInstructions(file)).toEqual({ status: "unreadable" })
  })

  test("render puts a heading on the text", () => {
    expect(renderOrgInstructions("- rule")).toStartWith("# Organisation instructions")
    expect(renderOrgInstructions("- rule")).toEndWith("- rule")
  })
})
