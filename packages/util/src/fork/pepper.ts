// fork_change - new file
//
// Where the key-sealing pepper comes from.
//
// The pepper used to be a literal in key-seal.ts, which put a value that gates
// every provisioned host's managed key into the git history of a repo that gets
// forked, mirrored, and shared. It now lives in a file *outside* the working
// tree, is read once at build time, and is baked into the binary through a Bun
// `define` — see packages/opencode/script/build.ts.
//
// The file holds the pepper and nothing else: one line, no quoting, no key/value
// syntax. Surrounding whitespace is trimmed, so a trailing newline is fine.
//
//   ~/.config/genix/key-pepper        (default; $XDG_CONFIG_HOME is honoured)
//   $KILO_FORK_KEY_PEPPER_FILE        (override, e.g. a CI runner temp path)
//
// A build with no pepper file fails loudly rather than shipping a binary that
// cannot unseal the keys already provisioned to hosts — see requirePepper().
//
// See FORK.md.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** Runtime override, also used by the tests to seal under a foreign pepper. */
export const PEPPER_ENV = "KILO_FORK_KEY_PEPPER"

/** Points the build (and an unbuilt run) at a pepper file elsewhere. */
export const PEPPER_FILE_ENV = "KILO_FORK_KEY_PEPPER_FILE"

/** The pepper file this build reads, honouring the override. */
export function pepperFilePath(): string {
  const override = process.env[PEPPER_FILE_ENV]?.trim()
  if (override) return override
  const config = process.env["XDG_CONFIG_HOME"]?.trim() || path.join(os.homedir(), ".config")
  return path.join(config, "genix", "key-pepper")
}

let cached: { value: string | undefined; from: string } | undefined

/**
 * The pepper held by the file, or undefined when the file is absent, unreadable,
 * or blank. Memoized per path: `managedKey()` runs on every provider state init,
 * and an unbuilt run resolves the pepper through here.
 */
export function readPepperFile(): string | undefined {
  const file = pepperFilePath()
  if (cached?.from !== file) {
    let value: string | undefined
    try {
      value = fs.readFileSync(file, "utf8").trim() || undefined
    } catch {
      value = undefined
    }
    cached = { value, from: file }
  }
  return cached.value
}

/** Forget the memoized read. For tests that move the file between cases. */
export function resetPepperCache(): void {
  cached = undefined
}

export class MissingPepperError extends Error {
  constructor(file: string) {
    super(
      [
        `key-sealing pepper not found: ${file}`,
        ``,
        `The pepper is deliberately not in the repository. Provision it before building:`,
        ``,
        `  mkdir -p "$(dirname "${file}")"`,
        `  printf %s "$GENIX_KEY_PEPPER" > "${file}"`,
        `  chmod 600 "${file}"`,
        ``,
        `Point ${PEPPER_FILE_ENV} elsewhere to use a different path. Changing the value`,
        `is a format break: every host already provisioned with a sealed key needs`,
        `re-sealing. See FORK.md.`,
      ].join("\n"),
    )
    this.name = "MissingPepperError"
  }
}

/**
 * The pepper, or a throw naming the file and how to provision it. Used by the
 * build scripts, so a missing pepper file fails the build instead of producing
 * a binary that reads every sealed key file as "no managed key".
 */
export function requirePepper(): string {
  const value = process.env[PEPPER_ENV]?.trim() || readPepperFile()
  if (!value) throw new MissingPepperError(pepperFilePath())
  return value
}
