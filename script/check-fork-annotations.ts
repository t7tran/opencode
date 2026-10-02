#!/usr/bin/env bun
// fork_change - new file
//
// Verifies that every fork-specific change in shared upstream-owned source files
// is annotated with a fork_change marker, so a rebase against upstream can tell
// our diff apart from upstream's own code at a glance.
//
// Usage:
//   bun run script/check-fork-annotations.ts                  # diff against upstream/dev
//   bun run script/check-fork-annotations.ts --base <ref>     # diff against <ref>
//
// A line is "covered" if it:
//   - contains a fork_change marker comment              (inline annotation)
//   - falls inside a fork_change start/end block         (block annotation)
//   - is in a file whose first non-shebang non-empty line is (whole-file annotation)
//     // fork_change - new file
//   - is empty / whitespace-only                         (skipped)
//   - is itself a marker line                            (auto-covered)
//
// JS (//), JSX ({/ * ... * /}), YAML (#), TOML (#), and shell (#) comment styles are recognized.
//
// Exempt paths (no fork markers needed):
//   - packages/util/src/fork/**
//   - packages/util/test/fork/**
//   - packages/core/src/fork/**
//   - Any path containing "fork" in a directory or file name
//   - script/check-fork-annotations.ts (this file)

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".yml",
  ".yaml",
  ".toml",
  ".nix",
  ".sh",
  ".bash",
  ".zsh",
])
// Extensionless files that are still comment-carrying sources.
const SOURCE_NAMES = new Set(["Dockerfile"])
// Shared upstream scopes — the directories where fork_change markers are
// required for non-exempt files.
const SCOPES = [
  // Upstream v2 dissolved packages/opencode into cli/server/core/util; the three
  // new homes are listed here so the same lines stay guarded after the move.
  "packages/cli",
  "packages/server",
  "packages/util",
  "packages/core",
  "packages/tui",
  "packages/ui",
  "packages/app",
  "packages/desktop",
  "packages/script",
  "packages/sdk",
  "packages/storybook",
  "script",
  "nix",
  ".github",
  "github",
  ".husky",
]
const EXEMPT_SCOPES = ["script/check-fork-annotations.ts"]

const args = process.argv.slice(2)
const baseIdx = args.indexOf("--base")
const base = baseIdx !== -1 ? args[baseIdx + 1] : "upstream/dev"

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" })
  if (result.status !== 0) {
    const msg = result.stderr?.trim() || result.stdout?.trim() || "unknown error"
    console.error(`Command failed: ${cmd} ${args.join(" ")}\n${msg}`)
    process.exit(1)
  }
  return result.stdout?.trim() ?? ""
}

function changedFiles() {
  const out = run("git", ["diff", "--name-only", "--diff-filter=AMRT", `${base}...HEAD`, "--", ...SCOPES])
  return out ? out.split("\n").filter(Boolean) : []
}

function isExempt(file: string) {
  const norm = file.replaceAll("\\", "/").toLowerCase()
  const parts = norm.split("/")
  if (parts.some((part) => part.includes("fork"))) return true
  return EXEMPT_SCOPES.some((scope) => norm === scope || norm.startsWith(`${scope}/`))
}

function isChecked(file: string) {
  const norm = file.replaceAll("\\", "/")
  return SCOPES.some((scope) => norm === scope || norm.startsWith(`${scope}/`))
}

function content(file: string) {
  const abs = path.join(ROOT, file)
  if (existsSync(abs)) return readFileSync(abs, "utf8")
  const out = run("git", ["show", `HEAD:${file}`])
  const target = out.trim()
  if (!target.startsWith("../")) return out
  return readFileSync(path.resolve(path.dirname(abs), target), "utf8")
}

function isSource(file: string) {
  const ext = path.extname(file)
  if (SOURCE_EXTS.has(ext)) return true
  if (SOURCE_NAMES.has(path.basename(file))) return true
  if (ext) return false
  return content(file).startsWith("#!")
}

// Matches the start of a fork_change marker in JS, JSX, YAML, TOML, and shell comments.
const MARKER_PREFIX = /(?:\/\/|\{?\s*\/\*|#)\s*fork_change\b/

function hasMarker(line: string) {
  return MARKER_PREFIX.test(line)
}

type FileDiff = { added: Set<number>; revert: boolean }

// One rename-aware diff for the whole tree, parsed per file.
//
// Rename detection is why this is not a per-file `git diff -- <path>`: limiting
// the pathspec to the new path hides the old one, so git falls back to
// add-plus-delete and a renamed upstream file reads as every-line-added. `-M`
// over the full diff pairs them up, so only the lines we actually changed are
// reported — which is the whole point for files like bin/genixcode.
function diffByFile(): Map<string, FileDiff> {
  const diff = run("git", ["diff", "--unified=0", "-M", "--diff-filter=AMRT", `${base}...HEAD`])
  const byFile = new Map<string, FileDiff>()
  const all = diff.split("\n")

  let current: FileDiff | undefined
  let start = 0
  let pos = 0

  for (const line of all) {
    if (line.startsWith("diff --git ")) {
      current = undefined
      continue
    }
    // "+++ b/path" names the post-image, which is the path changedFiles() sees.
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim()
      if (target === "/dev/null") {
        current = undefined
        continue
      }
      const file = target.startsWith("b/") ? target.slice(2) : target
      current = byFile.get(file) ?? { added: new Set<number>(), revert: false }
      byFile.set(file, current)
      continue
    }
    if (!current) continue

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk) {
      start = Number(hunk[1])
      pos = 0
      continue
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added.add(start + pos)
      pos++
      continue
    }
    if (line.startsWith("-") && !line.startsWith("---") && hasMarker(line.slice(1))) {
      current.revert = true
    }
  }

  return byFile
}

function coveredLines(text: string): { lines: string[]; covered: Set<number> } {
  const lines = text.split(/\r?\n/)
  const covered = new Set<number>()

  const first = lines.find((x) => x.trim() !== "" && !x.startsWith("#!"))
  if (first?.match(/(?:\/\/|\{?\s*\/\*|#)\s*fork_change\s*-\s*new\s*file\b/)) {
    for (let i = 1; i <= lines.length; i++) covered.add(i)
    return { lines, covered }
  }

  let block = false
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const line = lines[i] ?? ""

    if (line.match(/(?:\/\/|\{?\s*\/\*|#)\s*fork_change\s+start\b/)) {
      block = true
      covered.add(n)
      continue
    }

    if (line.match(/(?:\/\/|\{?\s*\/\*|#)\s*fork_change\s+end\b/)) {
      covered.add(n)
      block = false
      continue
    }

    if (block) {
      covered.add(n)
      continue
    }

    if (hasMarker(line)) covered.add(n)
  }

  return { lines, covered }
}

// --- main ---

const files = changedFiles().filter((f) => isChecked(f) && !isExempt(f) && isSource(f))
const diffs = diffByFile()

if (files.length === 0) {
  console.log("No shared upstream source files changed — nothing to check.")
  process.exit(0)
}

const violations: string[] = []

for (const file of files) {
  const { added, revert } = diffs.get(file) ?? { added: new Set<number>(), revert: false }
  if (added.size === 0) continue
  if (revert) continue

  const text = content(file)
  const { lines, covered } = coveredLines(text)

  for (const n of added) {
    const line = lines[n - 1] ?? ""
    const trim = line.trim()
    if (!trim) continue
    if (hasMarker(trim)) continue
    if (!covered.has(n)) violations.push(`  ${file}:${n}: ${trim}`)
  }
}

if (violations.length === 0) {
  console.log("All fork changes are annotated with fork_change markers.")
  process.exit(0)
}

console.error(
  [
    "Unannotated fork changes found in shared upstream files:",
    "",
    ...violations,
    "",
    "Every fork-specific change in shared upstream source files must be annotated.",
    "",
    "Inline (single line):",
    "  const url = baseURL // fork_change",
    "",
    "Block (multiple lines):",
    "  // fork_change start",
    "  ...",
    "  // fork_change end",
    "",
    "JSX/TSX:",
    "  {/* fork_change */}",
    "",
    "YAML/TOML/shell:",
    "  # fork_change",
    "",
    "New file:",
    "  // fork_change - new file",
    "",
    "Exempt paths (no markers needed):",
    "  - packages/core/src/fork/**",
    "  - packages/core/test/fork/**",
    "  - Any path containing 'fork'",
    "",
    "See FORK.md for details.",
  ].join("\n"),
)

process.exit(1)
