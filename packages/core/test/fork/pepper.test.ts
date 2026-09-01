// fork_change - new file
//
// Tests for where the key-sealing pepper comes from. The pepper is no longer a
// literal in the source tree, so the thing worth pinning is the resolution
// order and the loud failure a build depends on:
//   1. The path: default under $XDG_CONFIG_HOME, overridable by env.
//   2. Reading: trimmed, blank-is-absent, missing-is-absent (never a throw).
//   3. requirePepper(): env override wins, and a missing file throws — which is
//      what makes a build without a pepper fail instead of shipping a binary
//      that reads every sealed key file as "no managed key".

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  MissingPepperError,
  PEPPER_ENV,
  PEPPER_FILE_ENV,
  pepperFilePath,
  readPepperFile,
  requirePepper,
  resetPepperCache,
} from "../../src/fork/pepper"

const PEPPER = "a-pepper-from-a-file"

const ORIGINAL = {
  pepper: process.env[PEPPER_ENV],
  pepperFile: process.env[PEPPER_FILE_ENV],
  xdg: process.env["XDG_CONFIG_HOME"],
}

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-pepper-"))
  file = path.join(dir, "key-pepper")
  process.env[PEPPER_FILE_ENV] = file
  delete process.env[PEPPER_ENV]
  resetPepperCache()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  for (const [key, value] of [
    [PEPPER_ENV, ORIGINAL.pepper],
    [PEPPER_FILE_ENV, ORIGINAL.pepperFile],
    ["XDG_CONFIG_HOME", ORIGINAL.xdg],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetPepperCache()
})

describe("fork.pepper path", () => {
  test("the env override wins", () => {
    expect(pepperFilePath()).toBe(file)
  })

  test("defaults under XDG_CONFIG_HOME, outside the repo", () => {
    delete process.env[PEPPER_FILE_ENV]
    process.env["XDG_CONFIG_HOME"] = dir
    expect(pepperFilePath()).toBe(path.join(dir, "genix", "key-pepper"))
  })

  test("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    delete process.env[PEPPER_FILE_ENV]
    delete process.env["XDG_CONFIG_HOME"]
    expect(pepperFilePath()).toBe(path.join(os.homedir(), ".config", "genix", "key-pepper"))
  })
})

describe("fork.pepper read", () => {
  test("trims, so a trailing newline is not part of the pepper", () => {
    fs.writeFileSync(file, `  ${PEPPER}\n`)
    expect(readPepperFile()).toBe(PEPPER)
  })

  test("a missing file is absent, not an error", () => {
    expect(readPepperFile()).toBeUndefined()
  })

  test("a blank file is absent too", () => {
    fs.writeFileSync(file, "\n  \n")
    expect(readPepperFile()).toBeUndefined()
  })

  test("re-reads when the path changes, so one process can see two peppers", () => {
    fs.writeFileSync(file, PEPPER)
    expect(readPepperFile()).toBe(PEPPER)
    const other = path.join(dir, "other-pepper")
    fs.writeFileSync(other, "a-different-pepper")
    process.env[PEPPER_FILE_ENV] = other
    expect(readPepperFile()).toBe("a-different-pepper")
  })
})

describe("fork.pepper requirePepper", () => {
  test("returns the file's pepper", () => {
    fs.writeFileSync(file, PEPPER)
    expect(requirePepper()).toBe(PEPPER)
  })

  test("the env override wins over the file", () => {
    fs.writeFileSync(file, PEPPER)
    process.env[PEPPER_ENV] = "from-the-environment"
    expect(requirePepper()).toBe("from-the-environment")
  })

  test("throws when there is no pepper, so the build fails", () => {
    expect(() => requirePepper()).toThrow(MissingPepperError)
  })

  test("the throw names the file it looked for", () => {
    expect(() => requirePepper()).toThrow(file)
  })

  test("a blank file is the same as no file", () => {
    fs.writeFileSync(file, "\n")
    expect(() => requirePepper()).toThrow(MissingPepperError)
  })
})
