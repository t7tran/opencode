import { expect, test } from "bun:test"
import { CLI_NAME, CLI_PACKAGE_NAME, HOME_CONFIG_DIRNAME } from "@opencode/util/fork/brand"
import { discoverScript } from "./remote-cli"
import { wslCliInstallCommand } from "./runtime"

// Upstream installs WSL's CLI with its own `install` script piped into bash, which puts the public OpenCode CLI in
// the distro: a build with neither the provider lock nor the managed key file. This fork installs its own npm package
// instead (see ./remote-cli.ts), so what is worth pinning is that the generated command installs the fork's package
// and verifies the fork's binary, so a rebase cannot quietly restore upstream's installer.
test("installs through the fork's npm package, never upstream's install script", () => {
  const command = wslCliInstallCommand({ version: "0.0.0-dev-16365", binary: `C:\\local build's\\${CLI_NAME}` })

  expect(command).toContain("npm install -g")
  expect(command).toContain(`${CLI_PACKAGE_NAME}@0.0.0-dev-16365`)
  expect(command).toContain(`command -v ${CLI_NAME}`)
  expect(command).not.toContain("opencode.ai")
  expect(command).not.toContain("githubusercontent.com")
  expect(command).not.toContain("anomalyco")
})

test("looks for the fork's binary in the fork's install directory", () => {
  const script = discoverScript()

  expect(script).toContain(`$HOME/${HOME_CONFIG_DIRNAME}/bin/${CLI_NAME}`)
  expect(script).not.toContain(".opencode/bin/opencode")
})
