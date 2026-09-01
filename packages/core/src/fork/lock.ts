// fork_change - new file
//
// Hard provider lock for this fork of anomalyco/opencode.
//
// Only a single OpenAI-compatible provider (Genix) may be authorized,
// listed as connected, or used for model calls. Every other provider is
// unreachable — not merely hidden in the UI. Blocking happens at the
// server/handler layer (provider state init, list/authorize/callback/authSet/
// authRemove handlers) so a direct API or CLI call cannot bypass it.
//
// The provider identity is hardcoded: ID=genix, Display Name=Genix,
// Base URL=https://ai.gateway.genixventures.com/v1.
//
// Other configuration (API key and model list) is entered by the user via the
// normal provider config (opencode.json). The lock supplies the identity and
// base URL; the user-supplied config is deep-merged on top so only the locked
// provider is ever reachable.
//
// When the managed key file (/etc/kilo.key, see key-file.ts) exists,
// its contents become the API key and the user loses control of the credential
// entirely: the key is re-applied *after* user config so it cannot be
// overridden, and auth set/remove is refused at the handler layer.
//
// Tests opt out of the lock by setting KILO_FORK_DISABLE_PROVIDER_LOCK=1 in the
// test preload; in that mode every provider behaves as if unlocked.
//
// See FORK.md for the divergence-tracking convention.

import { Effect, Schema } from "effect"
import type { Info as ConfigProviderInfo } from "../v1/config/provider"
import { ProviderV2 } from "../provider"
import { managedKey } from "./key-file"

const PROVIDER_ID = "genix"
const PROVIDER_NAME = "Genix"
const PROVIDER_BASE_URL = "https://ai.gateway.genixventures.com/v1"
const PROVIDER_NPM = "@ai-sdk/openai-compatible"

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
    npm: PROVIDER_NPM,
    models: [],
  }
}

export function lockedProviderID(): ProviderV2.ID {
  return ProviderV2.ID.make(PROVIDER_ID)
}

export function isLockedProvider(id: string): boolean {
  // When the lock is disabled (tests), every provider is treated as allowed.
  if (!lockActive()) return true
  return id === PROVIDER_ID
}

export function lockedConfigProvider(models?: Record<string, { name: string }>): ConfigProviderInfo {
  const p = lockedProvider()
  return {
    name: p.name,
    npm: p.npm,
    options: {
      baseURL: p.baseURL,
    },
    ...(models && Object.keys(models).length > 0 ? { models } : {}),
  }
}

/**
 * Head config entry: the locked identity, applied *before* the user's own
 * provider config so opencode.json can still refine it. `models` is the list
 * discovered from the gateway when a managed key is in play — it seeds the
 * catalog, and a user entry for the same model id still wins.
 */
export function lockedConfigEntry(models?: Record<string, { name: string }>): [string, ConfigProviderInfo] {
  return [lockedProvider().id, lockedConfigProvider(models)]
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
 * Tail config entry: the managed API key *and* the gateway URL, re-applied
 * *after* the user's own provider config so neither can be shadowed by
 * opencode.json. Returns undefined when there is no managed key.
 *
 * `baseURL` is pinned here, not just in the head entry, because the head is
 * merged *under* user config: an `options.baseURL` in opencode.json would
 * otherwise win, and the managed key would then be sent as a bearer token to a
 * user-chosen endpoint — key exfiltration with no reverse engineering required.
 * `provider.ts` consults `options.baseURL` ahead of the per-model `api.url`, so
 * pinning it here is what actually decides where requests go.
 *
 * This is not a claim that a determined local user cannot recover the key —
 * they can, and see key-seal.ts for why that is unavoidable. It removes the
 * zero-effort path.
 */
export function lockedManagedEntry(): [string, ConfigProviderInfo] | undefined {
  const key = managedKey()
  if (!lockActive() || key === undefined) return undefined
  const p = lockedProvider()
  return [p.id, { options: { apiKey: key, baseURL: p.baseURL } }]
}

export class ForkProviderLockedError extends Schema.TaggedErrorClass<ForkProviderLockedError>()(
  "ForkProviderLockedError",
  {
    providerID: Schema.String,
    message: Schema.String,
  },
) {}

export function assertLockedProvider(providerID: string): Effect.Effect<void, ForkProviderLockedError> {
  if (isLockedProvider(providerID)) return Effect.void
  return Effect.fail(
    new ForkProviderLockedError({
      providerID,
      message: `Provider "${providerID}" is not allowed. This build is locked to the Genix provider; see FORK.md.`,
    }),
  )
}

export function filterProviderID(id: string): boolean {
  return isLockedProvider(id)
}
