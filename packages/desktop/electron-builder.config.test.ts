import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"
// fork_change start - the packaging identity is owned by the fork brand module;
// electron-builder.config.ts repeats it as literals because electron-builder
// loads that file outside the workspace resolver. These tests are what keep the
// two in step, and what keep upstream's identity from creeping back in.
import { appId as brandAppId, packageName, productName, PROTOCOL_SCHEME } from "@opencode-ai/core/fork/brand"
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

  // The v2 sidecar CLI is built by upstream, not by this fork, so it carries
  // neither the provider lock nor the managed key file. It must not be bundled.
  test(`does not bundle an upstream CLI in ${channel.channel} builds`, async () => {
    const config = await load(channel.channel, "no-cli")

    expect(JSON.stringify(config.extraResources)).not.toContain("cli")
    expect(JSON.stringify(config.files)).not.toContain("cli")
  })
  // fork_change end
}
