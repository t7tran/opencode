// fork_change - new file
//
// Hard provider lock for this fork of anomalyco/opencode.
//
// Only a single OpenAI-compatible provider (Genix) may be authorized, listed as
// connected, or used for model calls. Every other provider is unreachable — not
// merely hidden in the UI. Blocking happens at the server/handler layer and in
// the provider pipeline, so a direct API or CLI call cannot bypass it.
//
// The provider identity is hardcoded: ID=genix, Display Name=Genix,
// Base URL=https://ai.gateway.genixventures.com/v1.
//
// Other configuration (API key and model list) is entered by the user via the
// normal provider config (opencode.json). The lock supplies the identity and
// base URL; user config is merged on top by upstream's config provider plugin,
// and `plugin.ts` re-applies the managed key afterwards so it cannot be
// shadowed.
//
// When the managed key file (/etc/kilo.key, see key-file.ts) exists, its
// contents become the API key and the user loses control of the credential
// entirely: the key is re-applied *after* user config, and auth set/remove is
// refused at the handler layer.
//
// Tests opt out of the lock by setting KILO_FORK_DISABLE_PROVIDER_LOCK=1 in the
// test preload; in that mode every provider behaves as if unlocked.
//
// Upstream v2 note: v1 enforced this by splicing head/tail entries into the
// `configProviders` array that provider state init folded over. v2 has no such
// array — providers are records mutated by plugins through a transform editor —
// so the head/tail trick is replaced by `ForkLockPlugin` in
// packages/core/src/fork/plugin.ts, which runs after upstream's config provider
// plugin and therefore wins the same way the v1 tail entry did.
//
// This module lives in `packages/util` rather than `packages/core` because
// `packages/cli` is barred from importing core (see cli/test/import-boundaries)
// and still needs to refuse login/logout while a key is managed. It is
// dependency-free apart from effect and node builtins, so the leaf package is
// the one place every consumer can reach.
//
// See FORK.md for the divergence-tracking convention.

import { Effect, Schema } from "effect"
import { managedKey } from "./key-file.js"

const PROVIDER_ID = "genix"
const PROVIDER_NAME = "Genix"
const PROVIDER_BASE_URL = "https://ai.gateway.genixventures.com/v1"

/**
 * The provider package handed the API key. Upstream v1 named an `@ai-sdk/*` npm
 * package here; v2 resolves providers through its own bundled adapters, and the
 * OpenAI-compatible one is this built-in specifier.
 */
const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible"

/** Lock is active unless the test override disables it. */
export function lockActive(): boolean {
  return process.env.KILO_FORK_DISABLE_PROVIDER_LOCK !== "1"
}

export interface LockedProvider {
  id: string
  name: string
  baseURL: string
  apiKey?: string
  npm: string
  models: string[]
}

export function lockedProvider(): LockedProvider {
  return {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    baseURL: PROVIDER_BASE_URL,
    npm: PROVIDER_PACKAGE,
    models: [],
  }
}

export function isLockedProvider(id: string): boolean {
  // When the lock is disabled (tests), every provider is treated as allowed.
  if (!lockActive()) return true
  return id === PROVIDER_ID
}

/**
 * True when the API key is supplied by the managed key file rather than by the
 * user. In that mode the provider is always connected and every credential
 * mutation (connect, disconnect, login, logout) is refused.
 */
export function lockedProviderManaged(): boolean {
  return lockActive() && managedKey() !== undefined
}

/**
 * The settings the lock pins onto the locked provider once user config has been
 * folded in. `baseURL` is pinned alongside the key, not just at registration:
 * an `options.baseURL` in opencode.json would otherwise win, and the managed key
 * would then be sent as a bearer token to a user-chosen endpoint — key
 * exfiltration with no reverse engineering required.
 *
 * This is not a claim that a determined local user cannot recover the key —
 * they can, and see key-seal.ts for why that is unavoidable. It removes the
 * zero-effort path.
 *
 * Returns undefined when there is no managed key, in which case the user's own
 * credential stands.
 */
export function lockedManagedSettings(): { apiKey: string; baseURL: string } | undefined {
  const key = managedKey()
  if (!lockActive() || key === undefined) return undefined
  return { apiKey: key, baseURL: PROVIDER_BASE_URL }
}

export class ForkProviderLockedError extends Schema.TaggedError<ForkProviderLockedError>()(
  "ForkProviderLockedError",
  {
    providerID: Schema.String,
    message: Schema.String,
  },
) {}

export function lockedProviderMessage(providerID: string): string {
  return `Provider "${providerID}" is not allowed. This build is locked to the Genix provider; see FORK.md.`
}

export function assertLockedProvider(providerID: string): Effect.Effect<void, ForkProviderLockedError> {
  if (isLockedProvider(providerID)) return Effect.void
  return Effect.fail(
    new ForkProviderLockedError({
      providerID,
      message: lockedProviderMessage(providerID),
    }),
  )
}

export function filterProviderID(id: string): boolean {
  return isLockedProvider(id)
}
