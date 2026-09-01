// fork_change - new file
//
// The fork reads user-level configuration from `genixcode`-named directories,
// never upstream's `opencode`-named ones. Two independent things are asserted
// here because they are set in two different places and either can drift:
//
//   1. `Global.Path.*` — the XDG roots, keyed on `APP_DIRNAME` in global.ts.
//   2. `ConfigPaths` — the home-level dotdir walked by `directories()`, and the
//      `isConfigDirectory()` predicate that decides which of those directories
//      also carry their own `opencode.json` / `tui.json`.
//
// The predicate matters as much as the path: before the rename, callers tested
// `dir.endsWith(".opencode")` inline, which silently stops matching once the
// home directory is `~/.genixcode` — the skills and commands under it would
// still load while its config file was quietly ignored.

import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { APP_DIRNAME, HOME_CONFIG_DIRNAME } from "@opencode-ai/core/fork/brand"
import { ConfigPaths } from "@/config/paths"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node])))

describe("global paths", () => {
  test("every XDG root is named for the fork, not upstream", () => {
    const roots = [Global.Path.data, Global.Path.cache, Global.Path.config, Global.Path.state, Global.Path.tmp]
    for (const root of roots) {
      expect(path.basename(root)).toBe(APP_DIRNAME)
      expect(root.split(path.sep)).not.toContain("opencode")
    }
  })

  test("derived directories sit under the fork's data and cache roots", () => {
    expect(Global.Path.log).toBe(path.join(Global.Path.data, "log"))
    expect(Global.Path.repos).toBe(path.join(Global.Path.data, "repos"))
    expect(Global.Path.bin).toBe(path.join(Global.Path.cache, "bin"))
  })
})

describe("isConfigDirectory", () => {
  test("accepts the project dotdir and the fork's home dotdir", () => {
    expect(ConfigPaths.isConfigDirectory(path.join("/repo", ".opencode"))).toBe(true)
    expect(ConfigPaths.isConfigDirectory(path.join("/home/user", HOME_CONFIG_DIRNAME))).toBe(true)
  })

  test("rejects upstream's home dotdir and unrelated directories", () => {
    expect(ConfigPaths.isConfigDirectory(path.join("/home/user", ".opencode.bak"))).toBe(false)
    expect(ConfigPaths.isConfigDirectory(path.join("/home/user", "genixcode"))).toBe(false)
    expect(ConfigPaths.isConfigDirectory(path.join("/home/user", ".config", "genixcode"))).toBe(false)
  })
})

describe("directories", () => {
  it.instance("scans ~/.genixcode instead of ~/.opencode, and still scans project .opencode", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const home = Global.Path.home
      const forkHome = path.join(home, HOME_CONFIG_DIRNAME)
      const upstreamHome = path.join(home, ".opencode")
      const project = path.join(Global.Path.tmp, "fork-config-paths")
      const projectDotdir = path.join(project, ".opencode")

      yield* Effect.acquireUseRelease(
        Effect.all([
          fs.makeDirectory(forkHome, { recursive: true }),
          fs.makeDirectory(upstreamHome, { recursive: true }),
          fs.makeDirectory(projectDotdir, { recursive: true }),
        ]),
        () =>
          Effect.gen(function* () {
            const found = yield* ConfigPaths.directories(project, project)

            expect(found).toContain(Global.Path.config)
            expect(found).toContain(forkHome)
            // The project-level dotdir is a repository convention, not a brand
            // name, so it is deliberately left as `.opencode`.
            expect(found).toContain(projectDotdir)
            expect(found).not.toContain(upstreamHome)
          }),
        () =>
          Effect.all([
            fs.remove(forkHome, { recursive: true, force: true }).pipe(Effect.ignore),
            fs.remove(upstreamHome, { recursive: true, force: true }).pipe(Effect.ignore),
            fs.remove(project, { recursive: true, force: true }).pipe(Effect.ignore),
          ]),
      )
    }),
  )
})
