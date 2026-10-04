// Project config lives in `.genixcode/` and `genixcode.json(c)`, not upstream's
// `.opencode/` and `opencode.json(c)` (packages/core/src/config/discovery.ts;
// PROJECT_CONFIG_DIRNAME and CONFIG_FILENAMES in packages/util/src/fork/brand.ts).
// This runs the real discovery walk and the real agent loader over a project
// that has both, so a rebase that takes upstream's discovery.ts wholesale shows
// up here — and so does one that stops reading the singular `agent/` folder
// older projects still use.

import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { CONFIG_FILENAMES, PROJECT_CONFIG_DIRNAME } from "@opencode/util/fork/brand"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Credential } from "@opencode/core/credential"
import { WellKnown } from "@opencode/core/wellknown"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { agentHost, host } from "../plugin/host"

const it = testEffect(Layer.empty)

function testLayer(directory: string) {
  const global = path.join(directory, "global")
  return AppNodeBuilder.build(LayerNode.group([Config.node, Agent.node, Bus.node, FSUtil.node, Global.node]), [
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
}

const agent = (description: string) => `---\ndescription: ${description}\nmode: subagent\n---\nReview carefully.`

describe("project config dotdir", () => {
  test("is .genixcode, holding genixcode.json(c)", () => {
    expect(PROJECT_CONFIG_DIRNAME).toBe(".genixcode")
    expect(CONFIG_FILENAMES).toEqual(["genixcode.json", "genixcode.jsonc"])
  })

  it.live("loads .genixcode/ and genixcode.json, ignores .opencode/ and opencode.json", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, ".genixcode", "agent"), { recursive: true })
            await fs.mkdir(path.join(tmp.path, ".genixcode", "agents"), { recursive: true })
            await fs.mkdir(path.join(tmp.path, ".opencode", "agent"), { recursive: true })
            await fs.writeFile(path.join(tmp.path, ".genixcode", "agent", "singular.md"), agent("singular"))
            await fs.writeFile(path.join(tmp.path, ".genixcode", "agents", "plural.md"), agent("plural"))
            await fs.writeFile(path.join(tmp.path, ".opencode", "agent", "upstream.md"), agent("upstream"))
            await fs.writeFile(path.join(tmp.path, "genixcode.json"), JSON.stringify({ $schema: "root" }))
            await fs.writeFile(path.join(tmp.path, ".genixcode", "genixcode.jsonc"), JSON.stringify({ $schema: "dot" }))
            // What an OpenCode project carries. None of it should load.
            await fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ $schema: "opencode-root" }))
            await fs.writeFile(
              path.join(tmp.path, ".genixcode", "opencode.json"),
              JSON.stringify({ $schema: "opencode-dot" }),
            )
            await fs.writeFile(
              path.join(tmp.path, ".opencode", "opencode.json"),
              JSON.stringify({ $schema: "opencode" }),
            )
          })

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const entries = yield* config.entries()
            const local = (target: string) => target.startsWith(tmp.path + path.sep)
            expect(
              entries.flatMap((entry) => (entry.type === "directory" && local(entry.path) ? [entry.path] : [])),
            ).toEqual([
              AbsolutePath.make(path.join(tmp.path, "global")),
              AbsolutePath.make(path.join(tmp.path, ".genixcode")),
            ])
            expect(entries.flatMap((entry) => (entry.type === "document" ? [entry.info.$schema] : []))).toEqual([
              "root",
              "dot",
            ])

            const agents = yield* Agent.Service
            yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
            expect(yield* agents.get(Agent.ID.make("singular"))).toMatchObject({ description: "singular" })
            expect(yield* agents.get(Agent.ID.make("plural"))).toMatchObject({ description: "plural" })
            expect(yield* agents.get(Agent.ID.make("upstream"))).toBeUndefined()
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )
})
