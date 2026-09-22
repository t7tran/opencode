// fork_change - new file
//
// Tests for the shared service-registration path module. Verifies:
//   1. The registration filename matches what ServiceConfig.filename() produced
//      before it started delegating here — including the channel sanitiser.
//   2. Channels are recovered from the CLI version strings Script actually
//      builds, including branch-named local builds whose channel carries the
//      dashes and dots that make the parse non-trivial.
//   3. The path lands under this fork's XDG state root, not upstream's, and
//      follows XDG_STATE_HOME when the desktop repoints it mid-process.
//
// The regression behind all of this: the desktop watched
// `~/.local/state/opencode/service.json` while the CLI wrote
// `~/.local/state/genixcode/service-<channel>.json`, so the app sat on its
// splash screen respawning a CLI that kept exiting 0.

import { afterEach, describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { APP_DIRNAME } from "../../src/fork/brand.js"
import {
  channelFromVersion,
  isDefaultChannel,
  registrationFile,
  registrationFilename,
  stateRoot,
} from "../../src/fork/service-registration.js"

const originalStateHome = process.env["XDG_STATE_HOME"]

afterEach(() => {
  if (originalStateHome === undefined) delete process.env["XDG_STATE_HOME"]
  else process.env["XDG_STATE_HOME"] = originalStateHome
})

describe("registrationFilename", () => {
  test("upstream's shipping channels share the bare service.json", () => {
    for (const channel of ["latest", "dev", "beta", "next"]) {
      expect(isDefaultChannel(channel)).toBe(true)
      expect(registrationFilename(channel)).toBe("service.json")
    }
  })

  test("every other channel gets a file of its own", () => {
    expect(isDefaultChannel("local")).toBe(false)
    expect(registrationFilename("local")).toBe("service-local.json")
    expect(registrationFilename("prod")).toBe("service-prod.json")
    expect(registrationFilename("fork-on-v2.0.11")).toBe("service-fork-on-v2.0.11.json")
  })

  test("characters that are not path-safe are replaced", () => {
    expect(registrationFilename("feature/some thing")).toBe("service-feature-some-thing.json")
  })
})

describe("channelFromVersion", () => {
  test("preview builds carry their channel in the version", () => {
    expect(channelFromVersion("0.0.0-dev-412")).toBe("dev")
    expect(channelFromVersion("0.0.0-beta-412.2")).toBe("beta")
  })

  test("a branch-named channel survives its own dashes and dots", () => {
    expect(channelFromVersion("0.0.0-fork-on-v2.0.11-202609212250")).toBe("fork-on-v2.0.11")
    expect(channelFromVersion("0.0.0-fork-on-v2.0.11-412.2")).toBe("fork-on-v2.0.11")
  })

  test("a plain semver release is on latest", () => {
    expect(channelFromVersion("2.0.11")).toBe("latest")
  })

  // A release version carries no channel, so this is the best the string can do — and
  // it is wrong for this fork, which releases on "prod". The desktop must therefore read
  // the channel the build recorded (opencode-cli.channel) rather than derive it; this
  // test pins the gap so nobody re-adopts the derivation as the source of truth.
  test("a release version cannot recover this fork's prod channel", () => {
    expect(channelFromVersion("2.0.1100")).toBe("latest")
    expect(registrationFilename(channelFromVersion("2.0.1100"))).toBe("service.json")
    expect(registrationFilename("prod")).toBe("service-prod.json")
  })

  test("a CLI run from source reports local", () => {
    expect(channelFromVersion("local")).toBe("local")
    expect(channelFromVersion("")).toBe("local")
  })
})

describe("registrationFile", () => {
  test("lands under this fork's state root, not upstream's", () => {
    delete process.env["XDG_STATE_HOME"]
    const file = registrationFile("fork-on-v2.0.11")
    expect(file).toBe(
      path.join(os.homedir(), ".local", "state", APP_DIRNAME, "service-fork-on-v2.0.11.json"),
    )
    expect(file).not.toContain(`${path.sep}opencode${path.sep}`)
  })

  test("follows XDG_STATE_HOME, which the desktop repoints after startup", () => {
    process.env["XDG_STATE_HOME"] = path.join(path.sep, "tmp", "isolated-user-data")
    expect(stateRoot()).toBe(path.join(path.sep, "tmp", "isolated-user-data", APP_DIRNAME))
    expect(registrationFile("local")).toBe(
      path.join(path.sep, "tmp", "isolated-user-data", APP_DIRNAME, "service-local.json"),
    )
  })

  test("an empty XDG_STATE_HOME falls back to the home directory", () => {
    process.env["XDG_STATE_HOME"] = ""
    expect(stateRoot()).toBe(path.join(os.homedir(), ".local", "state", APP_DIRNAME))
  })
})
