import { $ } from "bun"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
// fork_change - no downloadCliToResources(): this fork does not bundle upstream's v2 CLI (see ./utils.ts)
