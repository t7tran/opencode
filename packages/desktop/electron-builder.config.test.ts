import { expect, test } from "bun:test"
import { statSync } from "node:fs"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Configuration } from "electron-builder"
import { getConfig } from "./electron-builder.config"
import { CLI_BINARIES, nodePtyPackage } from "./scripts/utils"
// fork_change start - the packaging identity is owned by the fork brand module;
// electron-builder.config.ts repeats it as literals because electron-builder
// loads that file outside the workspace resolver. These tests are what keep the
// two in step, and what keep upstream's identity from creeping back in.
import { appId as brandAppId, CLI_NAME, packageName, productName, PROTOCOL_SCHEME } from "@opencode/util/fork/brand"
// fork_change end

// Use electron-builder's matcher so the tests also cover its glob and directory traversal semantics.
const { FileMatcher } = createRequire(import.meta.resolve("electron-builder"))("app-builder-lib/out/fileMatcher")

// fork_change start
const channels = [
  { channel: "dev", appId: brandAppId("dev") },
  { channel: "beta", appId: brandAppId("beta") },
  { channel: "prod", appId: brandAppId("prod") },
] as const
// fork_change end

function load(channel: string, target?: string): Configuration {
  const previous = process.env.OPENCODE_CHANNEL
  const previousTarget = process.env.OPENCODE_CLI_TARGET
  process.env.OPENCODE_CHANNEL = channel

  if (target !== undefined) process.env.OPENCODE_CLI_TARGET = target
  else delete process.env.OPENCODE_CLI_TARGET

  try {
    return getConfig()
  } finally {
    delete process.env.OPENCODE_CHANNEL
    delete process.env.OPENCODE_CLI_TARGET

    if (previous !== undefined) process.env.OPENCODE_CHANNEL = previous

    if (previousTarget !== undefined) process.env.OPENCODE_CLI_TARGET = previousTarget
  }
}

function trimFilter(dir: string, config: Configuration) {
  const patterns = Array.isArray(config.files) ? config.files.flatMap((value) => (value ? [String(value)] : [])) : []

  return new FileMatcher(dir, "", (value: string) => value, [
    "**/*",
    ...patterns.filter((value) => value.startsWith("!")),
  ]).createFilter()
}

test.each(channels)("channel identity for $channel", ({ channel, appId }) => {
  const config = load(channel)
  expect(config.appId).toBe(appId)
  expect(config.extraMetadata?.desktopName).toBe(`${appId}.desktop`)
  // The executable must never end in `.desktop`: libappimage resolves the
  // AppImage's desktop entry by globbing `*.desktop`, and an ELF matching
  // that glob breaks integration (anomalyco/opencode#51867).
  expect(config.linux?.executableName).toBe(appId.replace(/\.desktop$/, ""))
  expect(config.linux?.executableName).not.toMatch(/\.desktop$/)
  // The installed `.desktop` filename still derives from `desktopName` so
  // window association (StartupWMClass/desktop file basename) is unchanged.
  expect(config.linux?.syncDesktopName).toBe(true)
  expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(appId)

  // fork_change start - .deb is the only Linux target, and the legacy
  // opencode-desktop launcher entry is gone; see electron-builder.config.ts.
  expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${appId}.metainfo.xml`))
  expect(config.deb?.fpm?.some((entry) => entry.includes("opencode-desktop.desktop"))).toBe(false)
  expect(config.deb?.fpm).not.toContain("--rpm-rpmbuild-define=_build_id_links none")
  // fork_change end
})

test("shared packaging defaults", async () => {
  const config = load("dev")
  expect(config.mac?.sign).toBeFunction()
  expect(config.dmg?.sign).not.toBe(true)
  expect(config.mac?.extendInfo?.NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac).toBe(true)
  const include = path.join(import.meta.dirname, "resources/windows/installer.nsh")
  expect(config.nsis?.include).toBe(include)
  expect(await Bun.file(include).exists()).toBe(true)
  // fork_change start - renamed bundled CLI; its channel file rides along with the version
  expect(config.files).toContain(`!resources/${CLI_NAME}*`)
  expect(config.extraResources).toEqual([
    { from: "resources/", to: "", filter: [CLI_NAME, `${CLI_NAME}.exe`, `${CLI_NAME}.version`, `${CLI_NAME}.channel`] },
  ])
  // fork_change end
})

test("trims external dependencies without excluding runtime files", () => {
  const fileStats = statSync(import.meta.filename)
  const dirStats = statSync(import.meta.dirname)
  const filter = trimFilter(import.meta.dirname, load("dev"))

  for (const prefix of ["node_modules/", "node_modules/parent/node_modules/"]) {
    const included = (file: string, stats = fileStats) => filter(path.join(import.meta.dirname, prefix, file), stats)

    // One file for each excluded pattern, including each brace alternative.
    for (const file of [
      "@zip.js/zip.js/dist/zip.js",
      ...["index.cjs", "index.min.js", "index-fflate.js", "deno.json", "eslint.config.mjs"].map(
        (name) => `@zip.js/zip.js/${name}`,
      ),
      ...["d.ts", "d.cts", "d.mts", "d.ts.map", "d.cts.map", "d.mts.map", "js.map", "cjs.map", "mjs.map"].map(
        (extension) => `unrelated/dist/index.${extension}`,
      ),
      "ajv/lib/core.ts",
      "ajv-formats/src/formats.ts",
      "js-yaml/dist/js-yaml.js",
      "js-yaml/dist/js-yaml.min.js",
      "js-yaml/dist/js-yaml.mjs.map",
      "js-yaml/bin/js-yaml.js",
    ]) {
      expect(included(file)).toBe(false)
    }

    for (const file of [
      "@zip.js/zip.js/index.js",
      "@zip.js/zip.js/lib/z-worker-inline.js",
      "electron-updater/out/main.js",
      "electron-updater/out/MacUpdater.js",
      "electron-updater/out/NsisUpdater.js",
      "electron-updater/out/providers/GitHubProvider.js",
      "builder-util-runtime/out/httpExecutor.js",
      "ajv/dist/ajv.js",
      "ajv/dist/refs/json-schema-draft-07.json",
      "ajv-formats/dist/formats.js",
      "js-yaml/index.js",
      "js-yaml/dist/js-yaml.mjs",
      "unrelated/dist/index.js",
      "unrelated/dist/index.cjs",
      "unrelated/dist/data.json",
      "unrelated/src/index.ts",
      ...["@zip.js/zip.js", "electron-updater", "builder-util-runtime", "ajv", "ajv-formats", "js-yaml"].flatMap(
        (name) => [`${name}/package.json`, `${name}/LICENSE`],
      ),
    ]) {
      expect(included(file)).toBe(true)
    }

    expect(included("@zip.js/zip.js/dist", dirStats)).toBe(false)
    expect(included("@zip.js/zip.js/lib", dirStats)).toBe(true)
  }

  for (const item of CLI_BINARIES) {
    const targetFilter = trimFilter(import.meta.dirname, load("prod", item.target))
    const active = nodePtyPackage(item.target)

    for (const candidate of CLI_BINARIES) {
      const pkg = nodePtyPackage(candidate.target)
      const included = targetFilter(path.join(import.meta.dirname, "node_modules", pkg, "lib/index.js"), fileStats)
      expect(included).toBe(pkg === active)
    }
  }
})

test("the trimmed Zip.js package can still export compressed logs", async () => {
  const config = load("dev")
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-zip-package-"))
  const source = path.dirname(fileURLToPath(import.meta.resolve("@zip.js/zip.js/package.json")))
  const filter = trimFilter(dir, config)

  try {
    await cp(source, dir, {
      recursive: true,
      filter: (file) =>
        filter(path.join(dir, "node_modules/@zip.js/zip.js", path.relative(source, file)), statSync(file)),
    })
    const zip = await import(pathToFileURL(path.join(dir, "index.js")).href)
    const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"))
    await writer.add("desktop.log", new zip.BlobReader(new Blob(["diagnostic log\n".repeat(100)])))
    const reader = new zip.ZipReader(new zip.BlobReader(await writer.close()))
    const entries = await reader.getEntries()
    expect(entries.map((entry: { filename: string }) => entry.filename)).toEqual(["desktop.log"])
    expect(entries[0].compressionMethod).toBe(8)
    expect(await entries[0].getData(new zip.TextWriter())).toBe("diagnostic log\n".repeat(100))
    await reader.close()
    await zip.terminateWorkers()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// fork_change start - the fork's packaging guarantees
for (const channel of channels) {
  // .deb is the only Linux artefact the fork builds, so the branded package name
  // has to ride on it (upstream's rides on rpm).
  test(`builds only a .deb for ${channel.channel}`, () => {
    const config = load(channel.channel)

    expect(config.linux?.target).toEqual(["deb"])
    expect(config.rpm).toBeUndefined()
  })

  test(`carries the fork brand for ${channel.channel}`, () => {
    const config = load(channel.channel)

    expect(config.productName).toBe(productName(channel.channel))
    expect(config.deb?.packageName).toBe(packageName(channel.channel))
    expect(config.protocols).toMatchObject({ schemes: [PROTOCOL_SCHEME] })
  })

  test(`keeps upstream's identity out of ${channel.channel} artefacts`, () => {
    const config = load(channel.channel)

    const surfaces = [
      config.appId,
      config.productName,
      config.artifactName,
      config.deb?.packageName,
      config.linux?.executableName,
      JSON.stringify(config.protocols),
      // Only the install destinations: the source side of an fpm mapping is an
      // absolute path into the checkout, which is named after upstream.
      ...(config.deb?.fpm ?? []).map((entry) => entry.split("=").at(-1)),
    ]

    for (const surface of surfaces) expect(String(surface).toLowerCase()).not.toContain("opencode")
  })

  // A `publish` block would point electron-updater at a release feed. Upstream's
  // points at opencode.ai, which would update a Genix build into upstream.
  test(`does not configure an update feed for ${channel.channel}`, () => {
    expect(load(channel.channel).publish).toBeUndefined()
  })

  // The CLI must still be bundled, and it must be one built from this tree rather
  // than downloaded from the registry (see the test below).
  test(`bundles the sidecar CLI in ${channel.channel} builds`, () => {
    const config = load(channel.channel)

    // The bundled executable is named after the fork's CLI, not upstream's
    // `opencode-cli` and not the desktop's own `genixcode` launcher.
    const resources = JSON.stringify(config.extraResources)
    expect(resources).toContain(`"${CLI_NAME}"`)
    expect(resources).not.toContain("opencode")
    expect(config.files).toContain(`!resources/${CLI_NAME}*`)
  })
}

// The other half of the guarantee above. `downloadCliToResources()` fetched the
// published `@opencode/cli-<platform>` package, which carries neither the provider
// lock nor the managed key file; deleting it is what stops a rebase quietly
// reintroducing an unlocked agent. scripts/prebuild.ts builds instead.
test("has no way to download a published CLI", async () => {
  const utils = await import("./scripts/utils")
  expect(Object.keys(utils)).not.toContain("downloadCliToResources")

  const prebuild = await Bun.file(new URL("./scripts/prebuild.ts", import.meta.url)).text()
  expect(prebuild).not.toContain("downloadCliToResources")
  expect(prebuild).toContain("copyBuiltCliToResources")
})
// fork_change end
