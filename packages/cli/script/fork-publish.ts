#!/usr/bin/env bun
// fork_change - new file
//
// Publishes the fork's CLI to npm under the "genixcode" package name.
//
// Upstream publishes the CLI with per-platform optional dependencies
// (@opencode/cli-linux-x64, @opencode/cli-darwin-arm64, ...). This script leaves
// upstream's publish.ts untouched — it publishes to registries and package repos
// we do not own — and instead:
//
//   1. Creates the GitHub release the desktop jobs upload their .deb to.
//      It does NOT attach the CLI archives — script/fork-release-assets.ts does
//      that, and fork-publish.yml runs it after this script. Run it by hand
//      after a local run of this one if the release needs the CLI archives.
//   2. Builds every platform binary via packages/cli/script/build.ts.
//   3. Rewrites each dist/<pkg>/package.json name from @opencode/cli-* to genixcode-*.
//   4. Assembles the super-package (launcher stub + postinstall + optional deps),
//      mirroring what publish.ts does for upstream.
//   5. Publishes each platform package and the super-package to npm.
//
// Upstream v2 note: v1's platform packages were unscoped ("opencode-linux-x64"),
// so the rename was a prefix swap on `pkg.name`. v2 scopes them under
// "@opencode/cli-", and the launcher builds that prefix from a template literal
// (`@opencode/cli${nodeBuild ? "-node" : ""}-`) rather than a single string — so
// the in-file rewrite below targets "@opencode/cli", not the full prefix.
//
// Usage:
//   bun run packages/cli/script/fork-publish.ts
//
// Requires:
//   - NPM_TOKEN         npm auth token with publish rights to genixcode*
//   - GH_TOKEN          for creating the release and uploading assets
//   - OPENCODE_VERSION  the version to publish; the workflow derives it from the tag
//
// See FORK.md.

import { $ } from "bun"
import { Script } from "@opencode/script"
import pkg from "../package.json"
import { dirname, join } from "node:path"

const dir = join(import.meta.dir, "..")
process.chdir(dir)

// gh targets the repo from GH_REPO when set; otherwise it falls back to gh's
// configured default, which may resolve to the upstream remote the local user
// cannot write to. Derive the fork repo from the git origin so local runs
// publish to the fork instead of upstream.
async function repoFromOrigin(): Promise<string | undefined> {
  const url = (
    await $`git remote get-url origin`
      .quiet()
      .text()
      .catch(() => "")
  ).trim()
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.#]+)/)
  return m ? `${m[1]}/${m[2]}` : undefined
}
const repo = process.env.GH_REPO || (await repoFromOrigin())
if (repo) process.env.GH_REPO = repo

/** Upstream's scope+stem for the platform packages, as build.ts writes them. */
const ORIGINAL_STEM = "@opencode/cli"
const FORK_NAME = "genixcode"
const ORIGINAL_PREFIX = `${ORIGINAL_STEM}-`
const FORK_PREFIX = `${FORK_NAME}-`
const LAUNCHER = `${FORK_NAME}.cjs`
const distDir = join(dir, "dist")

async function rewritePackageJson(path: string, fn: (pkg: any) => void) {
  const raw = await Bun.file(path).text()
  const parsed = JSON.parse(raw)
  fn(parsed)
  await Bun.file(path).write(JSON.stringify(parsed, null, 2) + "\n")
}

console.log("=== Creating GitHub release ===\n")

// The desktop jobs run `gh release upload v<version>`, which requires the
// release to already exist. Idempotent: skip if it does.
const tag = `v${Script.version}`
const isPre = !!Script.version.match(/-(alpha|beta|rc|pre)/)
const preFlag = isPre ? ["--prerelease"] : []
const exists = (await $`gh release view ${tag}`.nothrow().quiet()).exitCode === 0
if (!exists) {
  await $`gh release create ${tag} -d ${preFlag} --title ${tag} --notes ""`
} else {
  console.log(`  release ${tag} already exists, skipping create`)
}

console.log("\n=== Building CLI binaries (all platforms) ===\n")
await $`./script/build.ts`.env({
  ...process.env,
  OPENCODE_RELEASE: "true",
})

console.log("\n=== Rewriting package names ===\n")

// build.ts writes each platform package to dist/<target>/package.json — one
// level deep — with a scoped `name` inside.
function platformPackageJsonPaths(): string[] {
  const paths: string[] = []
  for (const rel of new Bun.Glob("*/package.json").scanSync({ cwd: distDir })) {
    paths.push(join(distDir, rel))
  }
  return paths
}

for (const pkgPath of platformPackageJsonPaths()) {
  await rewritePackageJson(pkgPath, (parsed) => {
    if (parsed.name?.startsWith(ORIGINAL_PREFIX)) {
      parsed.name = FORK_PREFIX + parsed.name.slice(ORIGINAL_PREFIX.length)
      console.log(`  ${parsed.name}`)
    }
    if (repo && parsed.repository?.url) parsed.repository.url = `https://github.com/${repo}`
  })
}

// Assemble the super-package. build.ts only produces platform packages; the
// super-package is assembled here, mirroring script/publish.ts.
const superPkgDir = join(distDir, FORK_NAME)
await $`mkdir -p ${superPkgDir}/bin`
await $`cp ${join(dir, "bin", LAUNCHER)} ${superPkgDir}/bin/${LAUNCHER}`
await $`cp ./script/postinstall.mjs ${superPkgDir}/postinstall.mjs`
await Bun.file(join(superPkgDir, "LICENSE")).write(await Bun.file(join(dir, "../../LICENSE")).text())

// The launcher resolves platform packages by name at install time, so it must
// name the renamed packages. postinstall.mjs derives them from
// optionalDependencies and needs no rewrite.
{
  const p = join(superPkgDir, "bin", LAUNCHER)
  const text = await Bun.file(p).text()
  await Bun.file(p).write(text.replaceAll(ORIGINAL_STEM, FORK_NAME))
}

const optionalDeps: Record<string, string> = {}
for (const pkgPath of platformPackageJsonPaths()) {
  const parsed = await Bun.file(pkgPath).json()
  if (parsed.name?.startsWith(FORK_PREFIX)) optionalDeps[parsed.name] = parsed.version
}

await Bun.file(join(superPkgDir, "package.json")).write(
  JSON.stringify(
    {
      name: FORK_NAME,
      bin: { [FORK_NAME]: `./bin/${LAUNCHER}` },
      scripts: { postinstall: "node ./postinstall.mjs" },
      version: Script.version,
      license: pkg.license,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: optionalDeps,
      ...(repo ? { repository: { type: "git", url: `https://github.com/${repo}` } } : {}),
    },
    null,
    2,
  ) + "\n",
)
console.log(`  super: ${FORK_NAME}`)

console.log("\n=== Publishing to npm ===\n")

async function publishPkg(pkgDir: string, name: string) {
  console.log(`  publishing ${name}...`)
  // GitHub artifact downloads can drop the executable bit.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(pkgDir)
  await $`bun pm pack`.cwd(pkgDir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(pkgDir).env({
    ...process.env,
    NODE_AUTH_TOKEN: process.env.NPM_TOKEN,
  })
}

const platformDirs: Record<string, string> = {}
for (const pkgPath of platformPackageJsonPaths()) {
  const parsed = await Bun.file(pkgPath).json()
  if (parsed.name?.startsWith(FORK_PREFIX)) platformDirs[parsed.name] = dirname(pkgPath)
}

for (const [name, pkgDir] of Object.entries(platformDirs)) {
  await publishPkg(pkgDir, name)
}
await publishPkg(superPkgDir, FORK_NAME)

console.log("\n=== Done ===\n")
console.log(`Published ${FORK_NAME} with ${Object.keys(platformDirs).length} platform packages.`)
