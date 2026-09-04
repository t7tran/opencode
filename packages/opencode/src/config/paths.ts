export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { HOME_CONFIG_DIRNAME } from "@opencode-ai/core/fork/brand" // fork_change

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".opencode"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [HOME_CONFIG_DIRNAME], // fork_change - `~/.genixcode`, not `~/.opencode`
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

// fork_change start - callers used to test `dir.endsWith(".opencode")` inline to
// decide whether a directory returned by `directories()` carries its own
// `opencode.json` / `tui.json`. The home-level directory is now `~/.genixcode`,
// which that test no longer matches, so the check lives here and knows both the
// project dotdir and the renamed home one.
export function isConfigDirectory(dir: string) {
  return dir.endsWith(".opencode") || path.basename(dir) === HOME_CONFIG_DIRNAME || dir === Flag.OPENCODE_CONFIG_DIR
}
// fork_change end
