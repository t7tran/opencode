#!/usr/bin/env bun
// fork_change - new file
//
// Archives the CLI binaries built by script/build.ts and attaches them to the
// fork's GitHub release.
//
// Upstream does not do this. Its script/publish.ts archives the same binaries
// but uploads them to the Cloudflare R2 bucket behind opencode.ai/files (see
// script/update-artifact.ts), which backs upstream's updater and its install
// script — infrastructure this fork does not own. Nothing in the fork's build
// path touched the GitHub release, so the release only ever carried the
// desktop .deb packages and fork-publish.yml's verification step failed on the
// missing CLI archives.
//
// Archive names mirror upstream's: "<cli name>-<target>.tar.gz" for linux
// targets, ".zip" for darwin and windows. The naming matters — fork-publish.yml
// requires one archive per OS family, matched on those suffixes.
//
// Usage (after script/build.ts has populated dist/):
//   GH_TOKEN=... GH_REPO=owner/repo bun run packages/cli/script/fork-release-assets.ts v1.2.3
//
// The tag defaults to "v" + OPENCODE_VERSION when not given as an argument.

import { $ } from "bun"
import { chmod, mkdir, readdir, rm, utimes } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"
import { CLI_NAME } from "@opencode/util/fork/brand"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

const distDir = path.resolve(process.env.OPENCODE_CLI_DIST ?? path.join(dir, "dist"))
const outDir = path.join(distDir, "release-assets")
const args = process.argv.slice(2)
const upload = !args.includes("--no-upload")
const tag = args.find((arg) => !arg.startsWith("--")) ?? `v${Script.version}`

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

// build.ts writes one directory per target, named "cli-<os>-<arch>[-baseline][-musl]".
// The node build, when present, lands under dist/node and is not released here.
const targets = (await readdir(distDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("cli-"))
  .map((entry) => entry.name.slice("cli-".length))
  .sort()

if (targets.length === 0) throw new Error(`No CLI build output in ${distDir} — run script/build.ts first`)

const archives: string[] = []
for (const target of targets) {
  const bin = path.join(distDir, `cli-${target}`, "bin")
  const executable = `${CLI_NAME}${target.startsWith("windows-") ? ".exe" : ""}`
  const source = path.join(bin, executable)
  const file = Bun.file(source)
  if (!(await file.exists()) || !file.size) throw new Error(`Missing binary: ${source}`)

  // GitHub artifact downloads lose execute bits. Fixed timestamps make retries reproducible.
  await chmod(source, 0o755)
  await utimes(source, new Date("1980-01-01T00:00:00Z"), new Date("1980-01-01T00:00:00Z"))

  const extension = target.startsWith("linux-") ? "tar.gz" : "zip"
  const output = path.join(outDir, `${CLI_NAME}-${target}.${extension}`)
  if (extension === "tar.gz") {
    await $`tar --mtime=@0 --owner=0 --group=0 --numeric-owner -czf ${output} -C ${bin} ${executable}`
  } else {
    // zip writes to the absolute output path while running in the bin directory,
    // so the archive holds just the executable with no leading path components.
    await $`zip -X -q ${output} ${executable}`.cwd(bin)
  }
  if (!(await Bun.file(output).exists())) throw new Error(`Failed to archive ${target}`)
  console.log(`  ${path.basename(output)}`)
  archives.push(output)
}

if (!upload) {
  console.log(`\narchived ${archives.length} CLI binaries to ${outDir} (upload skipped)`)
} else {
  console.log(`\nuploading ${archives.length} archives to release ${tag}`)
  await $`gh release upload ${tag} ${archives} --clobber`
}
