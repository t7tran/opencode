#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path" // fork_change - used by the local CLI build below

import { copyBuiltCliToResources, getCurrentCli, resolveChannel } from "./utils" // fork_change - the download helper is gone

const channel = resolveChannel()

await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

// fork_change start - upstream downloads a published CLI for dev and beta, and
// only copies a locally built one when OPENCODE_CLI_DIST is set (required for
// prod). This fork never downloads: the published binary carries neither the
// provider lock nor the managed key file, so bundling it would put an unlocked
// agent inside a locked build. See ./utils.ts and FORK.md § Desktop app.
//
// Every channel therefore bundles a CLI built from packages/cli in this tree —
// OPENCODE_CLI_DIST when the caller already built one, otherwise built here for
// the host target. That also drops upstream's "OPENCODE_CLI_DIST is required for
// production" guard: there is no longer a path that would silently fall back to
// a downloaded binary, so there is nothing for it to guard against.
//
// The build needs the key-sealing pepper; packages/cli/script/build.ts fails
// loudly without it rather than shipping a binary that cannot unseal a key file.
// See FORK.md § The sealing pepper.
const cliDir = join(import.meta.dir, "..", "..", "cli")
const dist = Bun.env.OPENCODE_CLI_DIST ?? (await buildCli())
await copyBuiltCliToResources(dist)

async function buildCli() {
  // utils.getCurrentCli() names the package for the host ("@opencode/cli-linux-x64-baseline");
  // build.ts takes the same target under its own prefix ("opencode-linux-x64-baseline").
  const target = getCurrentCli().package.replace("@opencode/cli-", "opencode-")
  console.log(`building ${target} for the desktop bundle`)
  await $`bun run script/build.ts --target=${target} --skip-install`.cwd(cliDir)
  return join(cliDir, "dist")
}
// fork_change end
