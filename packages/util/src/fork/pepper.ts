// fork_change - new file
//
// Where the key-sealing pepper comes from.
//
// The pepper used to be a literal in key-seal.ts, which put a value that gates
// every provisioned host's managed key into the git history of a repo that gets
// forked, mirrored, and shared. It now lives in a file *outside* the working
// tree, is read once at build time, and is baked into the binary through a Bun
// `define` — see packages/cli/script/build.ts.
//
// The file holds the pepper and nothing else: one line, no quoting, no key/value
// syntax. Surrounding whitespace is trimmed, so a trailing newline is fine.
//
//   $GENIXCODE_FORK_KEY_PEPPER_FILE   (override, e.g. a CI runner temp path; the only path read when set)
//   ~/.config/genix/key-pepper        (per-user default; $XDG_CONFIG_HOME is honoured)
//   /etc/genix/key-pepper             (system-wide, for a provisioned build or sealing host)
//
// The last two are the same pair the kilocode-based fork's build looked in, so a
// machine set up to build or seal for genix-cli does the same for genixcode-cli.
//
// A build with no pepper file fails loudly rather than shipping a binary that
// cannot unseal the keys already provisioned to hosts — see requirePepper().
//
// See FORK.md.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** Runtime override, also used by the tests to seal under a foreign pepper. */
export const PEPPER_ENV = "GENIXCODE_FORK_KEY_PEPPER"

/** Points the build (and an unbuilt run) at a pepper file elsewhere. */
export const PEPPER_FILE_ENV = "GENIXCODE_FORK_KEY_PEPPER_FILE"

/** System-wide pepper file, for a build or sealing host provisioned by an administrator. */
export const SYSTEM_PEPPER_FILE = path.join("/etc", "genix", "key-pepper")

/** Every pepper file this build would read, most specific first. The override, when set, is the only one. */
export function pepperFilePaths(): string[] {
  const override = process.env[PEPPER_FILE_ENV]?.trim()
  if (override) return [override]
  const config = process.env["XDG_CONFIG_HOME"]?.trim() || path.join(os.homedir(), ".config")
  return [path.join(config, "genix", "key-pepper"), SYSTEM_PEPPER_FILE]
}

/** The first candidate pepper file: the override, or the per-user default. */
export function pepperFilePath(): string {
  return pepperFilePaths()[0]!
}

let cached: { value: string | undefined; from: string } | undefined

/**
 * The pepper held by the first candidate file that has one, or undefined when
 * every candidate is absent, unreadable, or blank. Memoized per candidate list:
 * `managedKey()` runs on every provider state init, and an unbuilt run resolves
 * the pepper through here.
 */
export function readPepperFile(): string | undefined {
  const files = pepperFilePaths()
  const from = files.join("\0")
  if (cached?.from !== from) {
    let value: string | undefined
    for (const file of files) {
      try {
        value = fs.readFileSync(file, "utf8").trim() || undefined
      } catch {
        value = undefined
      }
      if (value) break
    }
    cached = { value, from }
  }
  return cached.value
}

/** Forget the memoized read. For tests that move the file between cases. */
export function resetPepperCache(): void {
  cached = undefined
}

export class MissingPepperError extends Error {
  constructor(paths: string | readonly string[]) {
    const files = typeof paths === "string" ? [paths] : paths
    const file = files[0]!
    super(
      [
        `key-sealing pepper not found: ${files.join(", ")}`,
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
  if (!value) throw new MissingPepperError(pepperFilePaths())
  return value
}
