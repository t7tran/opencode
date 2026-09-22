// fork_change - new file
//
// Managed API key file for the locked Genix provider.
//
// When `/etc/kilo.key` exists and is non-empty, its contents are the Genix API
// key — either in plain text, or as a sealed blob produced by `genixcode key
// seal` (see key-seal.ts). The CLI loads it automatically, the provider is
// always in the connected state, and the user cannot supply a different key or
// connect/disconnect the provider. Deleting the file restores the normal
// interactive login flow.
//
// The path is a fixed system location, not a per-user one: it is deliberately
// outside anything an unprivileged user can write, so a machine can be
// provisioned with a key that its users cannot change. On Windows it resolves
// against the current drive root (`C:\etc\kilo.key`).
//
// The path is shared with the sibling fork of Kilo-Org/kilocode, so a host
// provisioned once serves both builds.
//
// The `KILO_FORK_KEY_FILE` env var overrides the path; the test preload points
// it at a path that never exists so tests are hermetic.
//
// See FORK.md.

import fs from "node:fs"
import { unwrapKey } from "./key-seal.js"

export const DEFAULT_KEY_FILE = "/etc/kilo.key"

/** Absolute path of the managed key file. */
export function keyFilePath(): string {
  return process.env.KILO_FORK_KEY_FILE?.trim() || DEFAULT_KEY_FILE
}

/**
 * The managed key, or undefined when the file is absent, unreadable, blank, or
 * holds a sealed blob this build cannot unseal.
 *
 * Read on every call rather than cached, so provisioning the file (or removing
 * it) takes effect on the next provider state init without a CLI restart. The
 * file is a few dozen bytes and this is never called in a loop. An unreadable
 * file — most often a permissions problem, since this is a system path — is
 * treated the same as an absent one.
 */
export function managedKey(): string | undefined {
  try {
    return unwrapKey(fs.readFileSync(keyFilePath(), "utf8"))
  } catch {
    return undefined
  }
}

/** True when a usable managed key is present, i.e. the provider is fork-managed. */
export function managedKeyActive(): boolean {
  return managedKey() !== undefined
}

/**
 * Message shown wherever a credential action is refused because of the key file.
 * Deliberately does not name the path — the key is provisioned by whoever
 * administers the machine, and the file location is not the user's business.
 */
export function managedKeyRefusal(action: string): string {
  return `Cannot ${action}: the Genix API key is embedded.`
}
