import { readFileSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import type { Endpoint } from "@opencode/client/service"
// fork_change start - the registration this fork writes is neither in `opencode/`
// nor necessarily called `service.json`, so the probe has to be told where to look.
import { channelFromVersion, registrationFile } from "@opencode/util/fork/service-registration"
// fork_change end

// The main thread idles between showing the first window and evaluating the main bundle, waiting
// for the renderer's asset requests. That slot is long enough to find out whether a compatible
// background service is already running, so the renderer's first data request is not the first
// moment anyone asks. The probe only looks; a service that has to be started waits for the layers,
// which set the environment the CLI expects.
let probe: Promise<Endpoint | undefined> | undefined

export function startSidecarProbe() {
  if (!app.isPackaged) return
  const version = bundledVersion()
  if (!version) return
  // fork_change - the build ships the CLI's channel beside its version; see desktop-cli.ts
  const channel = bundledChannel() || channelFromVersion(version)
  probe = import("@opencode/client/service")
    .then(({ Service }) => Service.discover({ file: registrationFile(channel), version })) // fork_change - explicit registration path
    .catch(() => undefined)
}

export function sidecarProbe() {
  return probe ?? Promise.resolve(undefined)
}

function bundledVersion() {
  try {
    return readFileSync(path.join(process.resourcesPath, "opencode-cli.version"), "utf8").trim()
  } catch {
    return ""
  }
}

// fork_change start - the channel the bundled CLI was built on, which names the file it
// registers itself in. Read here rather than derived from the version, which cannot
// carry it for a plain-semver release. Empty means fall back to the derivation.
function bundledChannel() {
  try {
    return readFileSync(path.join(process.resourcesPath, "opencode-cli.channel"), "utf8").trim()
  } catch {
    return ""
  }
}
// fork_change end
