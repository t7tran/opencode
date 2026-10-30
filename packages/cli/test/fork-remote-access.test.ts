// fork_change - new file
//
// Remote access publishes the background service through a third-party tunnel, so the fork refuses to turn it on
// (src/fork/policy.ts `forkRemoteAccessEnabled`). Turning it off has to keep working: it is how a config written
// before the refusal gets cleaned up.

import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { forkRemoteAccessRefusal } from "../src/fork/policy"
import { ServiceConfig } from "../src/services/service-config"

const withConfig = async (
  body: (
    run: <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) => Promise<A>,
  ) => Promise<void>,
) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "genixcode-fork-remote-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  try {
    await body((effect) => Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer))))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test("service set remote true is refused and writes nothing", () =>
  withConfig(async (run) => {
    await expect(run(ServiceConfig.set("remote", "true"))).rejects.toThrow(forkRemoteAccessRefusal())
    expect(await run(ServiceConfig.read())).toEqual({})
    expect(await run(ServiceConfig.get("remote"))).toBe("false")
  }))

test("remote access written before the refusal can be turned off, and accepted consent does not reopen it", () =>
  withConfig(async (run) => {
    await run(ServiceConfig.remote())
    expect(await run(ServiceConfig.get("remote"))).toBe("true")
    await run(ServiceConfig.set("remote", "false"))
    expect(await run(ServiceConfig.read())).toEqual({ remoteAccepted: true })
    await expect(run(ServiceConfig.set("remote", "true"))).rejects.toThrow(forkRemoteAccessRefusal())
    expect(await run(ServiceConfig.read())).toEqual({ remoteAccepted: true })
  }))
