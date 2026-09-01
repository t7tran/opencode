// fork_change - new file
//
// Tests for the fork provider lock. Verifies:
//   1. lockedProvider() returns the hardcoded Genix identity.
//   2. isLockedProvider() accepts only "genix".
//   3. lockedConfigProvider() produces a valid ConfigProvider.Info with the hardcoded baseURL.
//   4. assertLockedProvider() fails for non-locked providers and succeeds for genix.

import { describe, expect, test, beforeAll } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import {
  lockedProvider,
  isLockedProvider,
  lockedConfigProvider,
  assertLockedProvider,
  ForkProviderLockedError,
} from "../../src/fork/lock"

// The global test preload disables the fork lock (KILO_FORK_DISABLE_PROVIDER_LOCK=1)
// so upstream provider tests run unmodified. These tests verify the LOCKED behavior,
// so re-enable it for this file.
beforeAll(() => {
  process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = ""
})

describe("fork.lock", () => {
  test("lockedProvider returns the hardcoded Genix identity", () => {
    const p = lockedProvider()
    expect(p.id).toBe("genix")
    expect(p.name).toBe("Genix")
    expect(p.baseURL).toBe("https://ai.gateway.genixventures.com/v1")
    expect(p.npm).toBe("@ai-sdk/openai-compatible")
  })
})

describe("fork.lock isLockedProvider", () => {
  test("returns true for genix", () => {
    expect(isLockedProvider("genix")).toBe(true)
  })

  test("returns false for other provider ids", () => {
    expect(isLockedProvider("anthropic")).toBe(false)
    expect(isLockedProvider("openai")).toBe(false)
    expect(isLockedProvider("kilo")).toBe(false)
  })
})

describe("fork.lock lockedConfigProvider", () => {
  test("produces a ConfigProvider.Info with the hardcoded identity", () => {
    const cfg = lockedConfigProvider()
    expect(cfg.name).toBe("Genix")
    expect(cfg.npm).toBe("@ai-sdk/openai-compatible")
    expect(cfg.options?.baseURL).toBe("https://ai.gateway.genixventures.com/v1")
  })

  test("does not hardcode an apiKey or env key (user supplies them)", () => {
    const cfg = lockedConfigProvider()
    expect(cfg.options?.apiKey).toBeUndefined()
    expect(cfg.env).toBeUndefined()
    expect(cfg.models).toBeUndefined()
  })
})

describe("fork.lock assertLockedProvider", () => {
  test("succeeds for genix", () => {
    const exit = Effect.runSync(Effect.exit(assertLockedProvider("genix")))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("fails with ForkProviderLockedError for a non-locked provider", () => {
    const exit = Effect.runSync(Effect.exit(assertLockedProvider("anthropic")))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause) as ForkProviderLockedError
      expect(err).toBeInstanceOf(ForkProviderLockedError)
      expect(err.providerID).toBe("anthropic")
      expect(err.message).toContain("locked")
    }
  })

  test("fails for every well-known provider", () => {
    for (const id of ["anthropic", "openai", "google", "openrouter", "kilo", "azure", "amazon-bedrock"]) {
      const exit = Effect.runSync(Effect.exit(assertLockedProvider(id)))
      expect(Exit.isFailure(exit)).toBe(true)
    }
  })
})
