// fork_change - new file
//
// Tests for the managed API key file (/etc/kilo.key). Verifies:
//   1. The default path, and the KILO_FORK_KEY_FILE override.
//   2. managedKey() reads and trims the file, and treats blank/missing as absent.
//   3. lockedProviderManaged() / lockedManagedSettings() reflect the file.
//   4. The managed entry carries the key *and* the gateway URL so both can be
//      re-applied over user config.
//   5. The pinned settings carry both the key and the gateway URL.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DEFAULT_KEY_FILE, keyFilePath, managedKey, managedKeyActive, managedKeyRefusal } from "../../src/fork/key-file.js"
import { lockedManagedSettings, lockedProviderManaged } from "../../src/fork/lock.js"

const ORIGINAL = {
  keyFile: process.env.KILO_FORK_KEY_FILE,
  lock: process.env.KILO_FORK_DISABLE_PROVIDER_LOCK,
}

let dir: string
let file: string

beforeEach(() => {
  // The global test preload disables the fork lock; these tests cover the locked behaviour.
  process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = ""
  // /etc is not writable in tests, so the override points at a temp file instead.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-key-file-"))
  file = path.join(dir, "kilo.key")
  process.env.KILO_FORK_KEY_FILE = file
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  if (ORIGINAL.keyFile === undefined) delete process.env.KILO_FORK_KEY_FILE
  else process.env.KILO_FORK_KEY_FILE = ORIGINAL.keyFile
  process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = ORIGINAL.lock ?? ""
})

describe("fork.key-file path resolution", () => {
  test("KILO_FORK_KEY_FILE overrides the path", () => {
    expect(keyFilePath()).toBe(file)
  })

  test("defaults to /etc/kilo.key", () => {
    delete process.env.KILO_FORK_KEY_FILE
    expect(keyFilePath()).toBe("/etc/kilo.key")
    expect(DEFAULT_KEY_FILE).toBe("/etc/kilo.key")
  })

  test("a blank override falls back to the default", () => {
    process.env.KILO_FORK_KEY_FILE = "   "
    expect(keyFilePath()).toBe("/etc/kilo.key")
  })
})

describe("fork.key-file managedKey", () => {
  test("is absent when the file does not exist", () => {
    expect(managedKey()).toBeUndefined()
    expect(managedKeyActive()).toBe(false)
  })

  test("reads and trims the file contents", () => {
    fs.writeFileSync(file, "  sk-genix-secret\n\n")
    expect(managedKey()).toBe("sk-genix-secret")
    expect(managedKeyActive()).toBe(true)
  })

  test("treats a blank file as absent", () => {
    fs.writeFileSync(file, "   \n")
    expect(managedKey()).toBeUndefined()
    expect(managedKeyActive()).toBe(false)
  })

  test("treats an unreadable path as absent rather than throwing", () => {
    process.env.KILO_FORK_KEY_FILE = path.join(dir, "no-such-dir", "kilo.key")
    expect(managedKey()).toBeUndefined()
  })

  test("picks up a key written after the first read", () => {
    expect(managedKeyActive()).toBe(false)
    fs.writeFileSync(file, "sk-later")
    expect(managedKey()).toBe("sk-later")
  })

  test("refusal message does not leak the key file path", () => {
    const message = managedKeyRefusal("log in")
    expect(message).toContain("Cannot log in")
    expect(message).not.toContain(file)
    expect(message).not.toContain("/etc/kilo.key")
  })
})

describe("fork.lock managed settings", () => {
  test("no managed settings without the key file", () => {
    expect(lockedProviderManaged()).toBe(false)
    expect(lockedManagedSettings()).toBeUndefined()
  })

  test("managed settings carry the key", () => {
    fs.writeFileSync(file, "sk-genix-secret")
    expect(lockedProviderManaged()).toBe(true)
    expect(lockedManagedSettings()?.apiKey).toBe("sk-genix-secret")
  })

  test("managed settings also pin the gateway URL, so opencode.json cannot redirect the key", () => {
    // The lock plugin folds these over user config, so an options.baseURL in
    // opencode.json cannot win and send the managed key to a chosen endpoint.
    fs.writeFileSync(file, "sk-genix-secret")
    expect(lockedManagedSettings()?.baseURL).toBe("https://ai.gateway.genixventures.com/v1")
  })

  test("no managed settings when the fork lock is disabled", () => {
    fs.writeFileSync(file, "sk-genix-secret")
    process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = "1"
    expect(lockedProviderManaged()).toBe(false)
    expect(lockedManagedSettings()).toBeUndefined()
  })
})
