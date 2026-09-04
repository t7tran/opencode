#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils" // fork_change - downloadCliToResources is gone

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
// fork_change - no downloadCliToResources(): this fork does not bundle upstream's v2 CLI (see ./utils.ts)
