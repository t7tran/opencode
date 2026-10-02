// The two lock predicates a caller can need before anything else has loaded.
//
// They live apart from lock.ts because lock.ts pulls in `effect` for its
// Schema-backed helpers, and the desktop's Electron entry module is kept free of
// it on purpose: Electron holds the ready event until that module has evaluated,
// so every import there delays the first window. The managed-key IPC channel has
// to be answering before that window's preload asks (see
// packages/desktop/src/main/fork-policy.ts), which puts its registration in the
// entry module. This file costs it `node:fs` and `node:crypto`, nothing more.
//
// lock.ts re-exports both, so every other caller keeps importing from there.

import { managedKey } from "./key-file.js"

/** Lock is active unless the test override disables it. */
export function lockActive(): boolean {
  return process.env.KILO_FORK_DISABLE_PROVIDER_LOCK !== "1"
}

/**
 * True when the API key is supplied by the managed key file rather than by the
 * user. In that mode the provider is always connected and every credential
 * mutation (connect, disconnect, login, logout) is refused.
 */
export function lockedProviderManaged(): boolean {
  return lockActive() && managedKey() !== undefined
}
