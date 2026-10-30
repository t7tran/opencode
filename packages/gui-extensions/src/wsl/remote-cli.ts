// The part of the SSH extension's remote CLI scripts that WSL uses. Extensions share only contracts, so
// keep the two copies in step.

import { CLI_NAME, CLI_PACKAGE_NAME, HOME_CONFIG_DIRNAME } from "@opencode/util/fork/brand" // fork_change - see ../ssh/remote-cli.ts

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function requireVersion(version: string) {
  if (version !== "local" && !/^[0-9][a-zA-Z0-9.+-]*$/.test(version)) throw new Error(version)

  return version
}

export function discoverScript() {
  // fork_change start - locate the fork's CLI, not upstream's
  return `cli=""
if [ -z "$cli" ] && [ -x "$HOME/${HOME_CONFIG_DIRNAME}/bin/${CLI_NAME}" ]; then cli="$HOME/${HOME_CONFIG_DIRNAME}/bin/${CLI_NAME}"; fi
if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
`
  // fork_change end
}

// Adapters supply a quoted shell expression, including remote HOME or wslpath expansion.
export function versionScript(command: string) {
  return `if [ -x ${command} ]; then ${command} --version 2>/dev/null || true; fi\n`
}

export function parseVersion(output: string) {
  const line = output
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()

  if (!line) return null
  const marker = line.lastIndexOf(" v")
  const version = marker === -1 ? line : line.slice(marker + 2)

  if (!version) throw new Error("V2 CLI did not provide a version")

  return version
}

/** The managed CLI installer also configures the user's shell PATH. */
export function installScript(input: { version: string; binary?: string }) {
  const version = requireVersion(input.version)

  // fork_change start - upstream pipes its own installer from GitHub into bash,
  // which puts the public OpenCode CLI in the distro: a build with neither the
  // provider lock nor the managed key file. This fork installs its own npm
  // package instead, so `binary` (a local development build) is not used here.
  // See FORK.md § What no longer reaches upstream.
  return `set -eu
npm install -g ${quote(`${CLI_PACKAGE_NAME}@${version}`)}
test "$("$(command -v ${CLI_NAME})" --version | awk '{print $NF}' | sed 's/^v//')" = ${quote(version)}
`
  // fork_change end
}
