// fork_change - new file
//
// Server-side enforcement of the provider lock.
//
// The UI changes elsewhere only remove dead affordances; these predicates are
// what actually refuses a credential mutation, so a direct API or CLI call
// cannot bypass the lock. v1 put this logic inline in the `auth.set` /
// `auth.remove` handlers. v2 routes the same operations through the integration
// and credential handlers, so the checks live here and are called from both.
//
// The returned message is user-facing and deliberately says only that the key is
// "embedded" — it never names the key file's path. The key is provisioned by
// whoever administers the machine, and the location is not the user's business.
//
// See FORK.md.

import { isLockedProvider, lockedProviderManaged, lockedProviderMessage } from "./lock.js"

const MANAGED_MESSAGE = "This build's API key is embedded and cannot be changed."

/**
 * Why a connect/disconnect against this integration must be refused, or
 * undefined when it is allowed. Integration ids and provider ids share a
 * namespace in v2 — a provider's integration defaults to its own id — so the
 * provider lock applies unchanged.
 */
export function credentialRefusal(integrationID: string): string | undefined {
  if (!isLockedProvider(integrationID)) return lockedProviderMessage(integrationID)
  if (lockedProviderManaged()) return MANAGED_MESSAGE
  return undefined
}

/** Why any credential mutation must be refused, regardless of which one. */
export function managedCredentialRefusal(): string | undefined {
  return lockedProviderManaged() ? MANAGED_MESSAGE : undefined
}

/**
 * Strip the managed API key out of a provider record on its way to a client.
 *
 * `settings` is part of the public provider shape, so it would otherwise carry
 * the key to every client (web UI, TUI, editor plugins). Nothing downstream
 * needs the secret, and a client could not act on the credential anyway — every
 * mutation is refused above. Only redacts while the key is managed; a key the
 * user typed in is still theirs to see.
 */
export function redactManagedKey<T extends { readonly settings?: Record<string, unknown> }>(provider: T): T {
  if (!lockedProviderManaged()) return provider
  if (provider.settings?.["apiKey"] === undefined) return provider
  const { apiKey: _redacted, ...settings } = provider.settings
  return { ...provider, settings }
}
