// fork_change start - Genix identity throughout. Upstream's metainfo names
// Anomaly Innovations as the developer and links to opencode.ai, the upstream
// issue tracker and a screenshot hosted in the upstream repo; none of those
// belong on an internal Genix build, and the fork has no public equivalents to
// swap in, so the outbound links are dropped rather than repointed.
import { appId as brandAppId, productName, VENDOR_NAME } from "@opencode/util/fork/brand"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = brandAppId(channel)
const name = productName(channel)
const summary = `Genix internal AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${name}</name>
  <summary>${summary}</summary>

  <developer id="com.genixventures">
    <name>${VENDOR_NAME}</name>
  </developer>

  <description>
    <p>
      ${name} is the Genix coding agent: an internal build for Genix employees, locked to
      Genix-approved model services.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
// fork_change end
