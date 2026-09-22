import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"
// fork_change start - the packaging identity is owned by the fork brand module;
// electron-builder.config.ts repeats it as literals because electron-builder
// loads that file outside the workspace resolver. These tests are what keep the
// two in step, and what keep upstream's identity from creeping back in.
import { appId as brandAppId, packageName, productName, PROTOCOL_SCHEME } from "@opencode/util/fork/brand"
// fork_change end

// fork_change start
const channels = [
  { channel: "dev", appId: brandAppId("dev") },
  { channel: "beta", appId: brandAppId("beta") },
  { channel: "prod", appId: brandAppId("prod") },
] as const
// fork_change end

// fork_change start - shared loader for the assertions below
async function load(channel: (typeof channels)[number]["channel"], tag: string) {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = channel

  const module = await import(`./electron-builder.config.ts?${tag}=${channel}`)
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous
  return config
}
// fork_change end

// fork_change start - the assertions below go through the shared loader
for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const config = await load(channel.channel, "identity")
    // fork_change end

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })

  // fork_change start - .deb is the only Linux artefact the fork builds, so the
  // branded package name has to ride on it (it used to ride on rpm).
  test(`builds only a .deb for ${channel.channel}`, async () => {
    const config = await load(channel.channel, "linux-target")

    expect(config.linux?.target).toEqual(["deb"])
    expect(config.rpm).toBeUndefined()
  })
  // fork_change end

  // fork_change start
  test(`carries the fork brand for ${channel.channel}`, async () => {
    const config = await load(channel.channel, "brand")

    expect(config.productName).toBe(productName(channel.channel))
    expect(config.deb?.packageName).toBe(packageName(channel.channel))
    expect(config.protocols).toMatchObject({ schemes: [PROTOCOL_SCHEME] })
  })

  test(`keeps upstream's identity out of ${channel.channel} artefacts`, async () => {
    const config = await load(channel.channel, "no-upstream")

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
    for (const surface of surfaces) {
      expect(String(surface).toLowerCase()).not.toContain("opencode")
    }
  })

  // A `publish` block would point electron-updater at a release feed. Upstream's
  // points at anomalyco/opencode, which would update a Genix build into upstream.
  test(`does not configure an update feed for ${channel.channel}`, async () => {
    const config = await load(channel.channel, "no-publish")
    expect(config.publish).toBeUndefined()
  })

  // Upstream v2 note: v1 asserted that *no* CLI was bundled, because the app
  // could run an embedded server built from packages/opencode instead. v2
  // dissolved that package — the bundled CLI is the only agent there is — so the
  // property worth pinning moved: the CLI must still be bundled, and it must be
  // one built from this tree rather than downloaded from the registry.
  test(`bundles the sidecar CLI in ${channel.channel} builds`, async () => {
    const config = await load(channel.channel, "cli-bundled")

    expect(JSON.stringify(config.extraResources)).toContain("opencode-cli")
  })
  // fork_change end
}

// fork_change start - the other half of the guarantee above. `downloadCliToResources()`
// fetched the published `@opencode/cli-<platform>` package, which carries neither
// the provider lock nor the managed key file; deleting it is what stops a rebase
// quietly reintroducing an unlocked agent. scripts/prebuild.ts builds instead.
test("has no way to download a published CLI", async () => {
  const utils = await import("./scripts/utils")
  expect(Object.keys(utils)).not.toContain("downloadCliToResources")

  const prebuild = await Bun.file(new URL("./scripts/prebuild.ts", import.meta.url)).text()
  expect(prebuild).not.toContain("downloadCliToResources")
  expect(prebuild).toContain("copyBuiltCliToResources")
})
// fork_change end
