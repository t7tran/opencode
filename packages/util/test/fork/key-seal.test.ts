// fork_change - new file
//
// Tests for the sealed form of the managed API key file. Verifies:
//   1. Round-tripping, and that sealing is deterministic (Terraform idempotency).
//   2. The blob shape: single-line, ASCII, prefixed, and not the plain key.
//   3. Rejection of tampered blobs, truncated blobs, and blobs sealed under a
//      different pepper — a wrong build must not silently produce a bad key.
//   4. managedKey() accepts both forms, so existing plain key files keep working.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SEALED_PREFIX, isSealed, keyFingerprint, seal, unseal, unwrapKey } from "../../src/fork/key-seal.js"
import { managedKey, managedKeyActive } from "../../src/fork/key-file.js"
import { lockedManagedSettings, lockedProviderManaged } from "../../src/fork/lock.js"
import { pepperFilePath, readPepperFile } from "../../src/fork/pepper.js"

const KEY = "sk-genix-abc123-XYZ_secret"

// The real pepper is not in the repo (see src/fork/pepper.ts), so everything
// that only needs *a* pepper runs under a fixed synthetic one. Only the
// golden-vector block below needs the shipped value.
const TEST_PEPPER = "genix-test-pepper"

const ORIGINAL = {
  keyFile: process.env.KILO_FORK_KEY_FILE,
  pepper: process.env.KILO_FORK_KEY_PEPPER,
  lock: process.env.KILO_FORK_DISABLE_PROVIDER_LOCK,
}

let dir: string
let file: string

beforeEach(() => {
  // The global test preload disables the fork lock; these tests cover the locked behaviour.
  process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = ""
  // /etc is not writable in tests, so the override points at a temp file instead.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-key-seal-"))
  file = path.join(dir, "kilo.key")
  process.env.KILO_FORK_KEY_FILE = file
  process.env.KILO_FORK_KEY_PEPPER = TEST_PEPPER
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  if (ORIGINAL.keyFile === undefined) delete process.env.KILO_FORK_KEY_FILE
  else process.env.KILO_FORK_KEY_FILE = ORIGINAL.keyFile
  if (ORIGINAL.pepper === undefined) delete process.env.KILO_FORK_KEY_PEPPER
  else process.env.KILO_FORK_KEY_PEPPER = ORIGINAL.pepper
  process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = ORIGINAL.lock ?? ""
})

describe("fork.key-seal round trip", () => {
  test("seals and unseals a key", () => {
    const blob = seal(KEY)
    expect(blob).not.toContain(KEY)
    expect(unseal(blob)).toBe(KEY)
  })

  test("sealing is deterministic, so re-provisioning does not churn", () => {
    expect(seal(KEY)).toBe(seal(KEY))
  })

  test("different keys seal differently", () => {
    expect(seal(KEY)).not.toBe(seal(KEY + "2"))
  })

  test("trims the key before sealing, so a trailing newline is not part of it", () => {
    expect(seal(`  ${KEY}\n`)).toBe(seal(KEY))
    expect(unseal(seal(`  ${KEY}\n`))).toBe(KEY)
  })

  test("refuses to seal an empty key", () => {
    expect(() => seal("   \n")).toThrow()
  })
})

describe("fork.key-seal blob shape", () => {
  test("is a single line of prefixed base64url", () => {
    const blob = seal(KEY)
    expect(blob.startsWith(SEALED_PREFIX)).toBe(true)
    expect(blob).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
    expect(blob.includes("\n")).toBe(false)
  })

  test("isSealed distinguishes the two forms", () => {
    expect(isSealed(seal(KEY))).toBe(true)
    expect(isSealed(KEY)).toBe(false)
    // The file is trimmed before use, but be tolerant of leading whitespace anyway.
    expect(isSealed(`  ${seal(KEY)}`)).toBe(true)
  })
})

describe("fork.key-seal rejection", () => {
  test("a plain key is not a blob", () => {
    expect(unseal(KEY)).toBeUndefined()
  })

  test("a tampered blob fails authentication", () => {
    const blob = seal(KEY)
    const flipped = blob.slice(0, -1) + (blob.at(-1) === "A" ? "B" : "A")
    expect(unseal(flipped)).toBeUndefined()
  })

  test("a truncated blob is rejected rather than throwing", () => {
    expect(unseal(SEALED_PREFIX)).toBeUndefined()
    expect(unseal(SEALED_PREFIX + "aaaa")).toBeUndefined()
    expect(unseal(SEALED_PREFIX + "!!!not-base64!!!")).toBeUndefined()
  })

  test("a blob sealed under a different pepper is rejected", () => {
    process.env.KILO_FORK_KEY_PEPPER = "some-other-build"
    const foreign = seal(KEY)
    process.env.KILO_FORK_KEY_PEPPER = TEST_PEPPER
    expect(unseal(foreign)).toBeUndefined()
  })
})

describe("fork.key-seal unwrapKey", () => {
  test("passes a plain key through", () => {
    expect(unwrapKey(`  ${KEY}\n`)).toBe(KEY)
  })

  test("unseals a blob", () => {
    expect(unwrapKey(`${seal(KEY)}\n`)).toBe(KEY)
  })

  test("blank and unusable content are both absent", () => {
    expect(unwrapKey("  \n")).toBeUndefined()
    expect(unwrapKey(SEALED_PREFIX + "aaaa")).toBeUndefined()
  })
})

describe("fork.key-seal fingerprint", () => {
  test("is stable, short, and not the key", () => {
    const print = keyFingerprint(KEY)
    expect(print).toBe(keyFingerprint(`${KEY}\n`))
    expect(print).toMatch(/^[0-9a-f]{12}$/)
    expect(print).not.toContain(KEY)
    expect(keyFingerprint(KEY)).not.toBe(keyFingerprint(KEY + "2"))
  })
})

// A blob sealed by the shipped pepper. Pinned because the extension host
// carries its own copy of the codec (packages/kilo-vscode/src/shared/managed-key.ts,
// exercised by that package's tests/unit/managed-key.test.ts) and the two must
// agree. If this fails, either the codec changed — in which case every already
// provisioned host needs re-sealing, so treat it as a format break — or the two
// copies have drifted apart.
const GOLDEN = "v1.zfVk706lAlnSiOQlxkOHAsZ0zXTaJCx49PnWjjAsDS1Fip6Xj8vqWJ6wwqiMh_1vbryqJ55L"

// These two need the shipped pepper, which lives outside the working tree, so a
// checkout without the pepper file cannot run them. Skipped rather than failed —
// but never silently: a build is what must fail when the pepper is missing.
const provisioned = readPepperFile() !== undefined
if (!provisioned) {
  console.warn(`fork.key-seal: no pepper at ${pepperFilePath()} — skipping the golden-vector tests`)
}
const describeGolden = provisioned ? describe : describe.skip

describeGolden("fork.key-seal format stability", () => {
  // The golden vectors are the shipped pepper's, so the synthetic override goes.
  beforeEach(() => {
    delete process.env.KILO_FORK_KEY_PEPPER
  })

  test("still seals the pinned key to the pinned blob", () => {
    expect(seal(KEY)).toBe(GOLDEN)
  })

  test("still unseals the pinned blob", () => {
    expect(unseal(GOLDEN)).toBe(KEY)
  })
})

describe("fork.key-file with a sealed file", () => {
  test("a sealed file yields the plain key", () => {
    fs.writeFileSync(file, seal(KEY) + "\n")
    expect(managedKey()).toBe(KEY)
    expect(managedKeyActive()).toBe(true)
  })

  test("a plain file still yields the key, unchanged", () => {
    fs.writeFileSync(file, `  ${KEY}\n`)
    expect(managedKey()).toBe(KEY)
    expect(managedKeyActive()).toBe(true)
  })

  test("the locked provider picks up the unsealed key", () => {
    fs.writeFileSync(file, seal(KEY))
    expect(lockedProviderManaged()).toBe(true)
    expect(lockedManagedSettings()?.apiKey).toBe(KEY)
  })

  test("a blob this build cannot unseal reads as no managed key at all", () => {
    process.env.KILO_FORK_KEY_PEPPER = "some-other-build"
    const foreign = seal(KEY)
    process.env.KILO_FORK_KEY_PEPPER = TEST_PEPPER
    fs.writeFileSync(file, foreign)
    expect(managedKey()).toBeUndefined()
    expect(managedKeyActive()).toBe(false)
    expect(lockedProviderManaged()).toBe(false)
  })
})
