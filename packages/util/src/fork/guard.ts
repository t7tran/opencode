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

import { isLockedProvider, lockedProvider, lockedProviderManaged, lockedProviderMessage } from "./lock.js"

const MANAGED_MESSAGE = "This build's API key is embedded and cannot be changed."

/**
 * Why a connect/disconnect against this integration must be refused, or
 * undefined when it is allowed. Integration ids and provider ids share a
 * namespace in v2 — a provider's integration defaults to its own id — so the
 * provider lock applies unchanged.
 */
export function credentialRefusal(integrationID: string): string | undefined {
  // MCP servers are not providers: the lock does not apply to them, and where
  // they may connect is decided by the domain allowlist instead (mcp-domains.ts).
  if (isMcpIntegration(integrationID)) return undefined
  if (!isLockedProvider(integrationID)) return lockedProviderMessage(integrationID)
  if (lockedProviderManaged()) return MANAGED_MESSAGE
  return undefined
}

/**
 * Whether an integration id is one core's MCP layer registered for a remote
 * server: `mcp_` and the first 16 hex digits of a SHA-1 over its name and URL
 * (packages/core/src/mcp/index.ts). Nothing else produces that shape.
 */
export function isMcpIntegration(integrationID: string): boolean {
  return /^mcp_[0-9a-f]{16}$/.test(integrationID)
}

/**
 * Why removing or switching a stored credential must be refused while the key
 * is managed. Only the locked provider's own credential is the key file's to
 * own; an MCP server's, or a stale one for a provider the lock has pruned, is
 * the user's to log out of. `integrationID` is undefined when the credential
 * could not be found, which is refused rather than guessed at.
 */
export function managedCredentialRefusal(integrationID?: string): string | undefined {
  if (!lockedProviderManaged()) return undefined
  if (integrationID !== undefined && integrationID !== lockedProvider().id) return undefined
  return MANAGED_MESSAGE
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
