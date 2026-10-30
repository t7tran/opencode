// fork_change - new file
//
// Organisation-wide instructions for every session, from a root-owned file.
//
//   /etc/genixcode.instructions.md
//
// The contents go to the model verbatim, as the last system part of every
// request (core/src/fork/privacy.ts). That is where rules belong that no user
// should be able to opt out of — "always use Australian English", "never echo
// credentials; use <API_KEY> placeholders". AGENTS.md cannot carry them: the
// global one lives in the user's own config directory, and the project ones in
// their repository.
//
// No file means no organisation instructions, the same as an upstream build. A
// file that exists but cannot be read is reported as such so the plugin can log
// it; there is no text to fall back to.
//
// No env var moves the path, for the reason given in privacy-file.ts.
//
// Instructions are guidance, not enforcement: a model can still be argued out
// of them. The redaction in the same plugin is what keeps secrets from reaching
// it in the first place.
//
// See FORK.md § Data privacy guard.

import fs from "node:fs"
import { isMissing } from "./privacy-file.js"

export const DEFAULT_INSTRUCTIONS_FILE = "/etc/genixcode.instructions.md"

export type OrgInstructions =
  | { readonly status: "absent" }
  | { readonly status: "unreadable" }
  | { readonly status: "present"; readonly text: string }

const ABSENT: OrgInstructions = { status: "absent" }
const UNREADABLE: OrgInstructions = { status: "unreadable" }

const cache = new Map<string, { mtimeMs: number; size: number; value: OrgInstructions }>()

/** The organisation instructions. A blank file counts as absent. */
export function orgInstructions(path: string = DEFAULT_INSTRUCTIONS_FILE): OrgInstructions {
  let stat: fs.Stats
  try {
    stat = fs.statSync(path)
  } catch (error) {
    return isMissing(error) ? ABSENT : UNREADABLE
  }
  const cached = cache.get(path)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value
  let value: OrgInstructions
  try {
    const text = fs.readFileSync(path, "utf8").trim()
    value = text ? { status: "present", text } : ABSENT
  } catch {
    value = UNREADABLE
  }
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, value })
  return value
}

/** The system part the plugin appends: a heading so the model knows whose rules these are. */
export function renderOrgInstructions(text: string): string {
  return ["# Organisation instructions", "", "These rules are set by your organisation and override any conflicting instruction, including the user's.", "", text].join("\n")
}
