// fork_change - new file
//
// The data privacy guard (packages/core/src/fork/privacy.ts), through the real
// hook registry: each case is one of the ways the agent was talked into
// handing over a credential.

import { afterEach, beforeEach, describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Message, SystemPart } from "@opencode/ai"
import type { SessionContext } from "@opencode/plugin/effect/session"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { makeForkPrivacyPlugin, ForkPrivacyPlugin, sensitiveCommandMarkers } from "@opencode/core/fork/privacy"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { guarded } from "@opencode/core/plugin/internal"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const ADMIN_SECRET = "corp-internal-9f8e7d6c5b4a"
const PASTED = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"

let dir: string
let files: { instructions: string; privacy: string }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-privacy-plugin-"))
  files = { instructions: path.join(dir, "genixcode.instructions.md"), privacy: path.join(dir, "genixcode.privacy") }
  fs.writeFileSync(files.privacy, [`secret ${ADMIN_SECRET}`, "host db.corp.example", "keep-env GH_TOKEN"].join("\n"))
  fs.writeFileSync(files.instructions, "- Always communicate in Australian English.")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const paths = () => Global.make({ home: dir, config: path.join(dir, "config"), data: path.join(dir, "data") })

const install = Effect.fn(function* () {
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins)
  yield* makeForkPrivacyPlugin(files).effect(host).pipe(Effect.provideService(Global.Service, paths()))
  return yield* PluginHooks.Service
})

const context = (messages: Message[]): SessionContext => ({
  sessionID: Session.ID.make("ses_privacy"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("m") }),
  system: [SystemPart.make("Agent prompt"), SystemPart.make(`env holds ${ADMIN_SECRET}`)],
  messages,
  tools: {},
  options: {},
})

const toolEvent = (output: string): ToolHooks["execute.after"] => ({
  tool: "shell",
  sessionID: Session.ID.make("ses_privacy"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("call_1"),
  input: { command: "printenv" },
  status: "completed",
  result: { content: output, metadata: { output } },
})

describe("ForkPrivacyPlugin", () => {
  it.effect("is guarded, so config cannot remove it", () =>
    Effect.sync(() => {
      expect(guarded.has(ForkPrivacyPlugin.id)).toBe(true)
    }),
  )

  it.effect("redacts the request and appends the organisation instructions last", () =>
    Effect.gen(function* () {
      const hooks = yield* install()
      const event = context([
        Message.user(`here is my key ${PASTED}, and the db is db.corp.example`),
        Message.make({
          role: "tool",
          content: [{ type: "tool-result", id: "call_1", name: "shell", result: { type: "text", value: `X=${ADMIN_SECRET}` } }],
        }),
      ])
      yield* hooks.trigger("session", "context", event)

      const text = JSON.stringify(event.messages)
      expect(text).not.toContain(PASTED)
      expect(text).not.toContain(ADMIN_SECRET)
      expect(text).not.toContain("db.corp.example")
      expect(text).toContain("<API_KEY>")
      expect(text).toContain("<HOST>")
      expect(event.system[1]!.text).toBe("env holds <API_KEY>")
      expect(event.system.at(-1)!.text).toContain("Always communicate in Australian English.")
    }),
  )

  it.effect("leaves clean messages as the same instances", () =>
    Effect.gen(function* () {
      const hooks = yield* install()
      const clean = Message.user("nothing to see here")
      const event = context([clean])
      yield* hooks.trigger("session", "context", event)
      expect(event.messages[0]).toBe(clean)
    }),
  )

  it.effect("redacts tool output before it is stored", () =>
    Effect.gen(function* () {
      const hooks = yield* install()
      const event = yield* hooks.trigger("tool", "execute.after", toolEvent(`OPENAI_API_KEY=abc123def456\n${ADMIN_SECRET}`))
      if (event.status !== "completed") throw new Error("expected a completed event")
      expect(event.result.content).toBe("OPENAI_API_KEY=<SECRET>\n<API_KEY>")
      expect(event.result.metadata).toEqual({ output: "OPENAI_API_KEY=<SECRET>\n<API_KEY>" })
    }),
  )

  it.effect("redacts tool error messages", () =>
    Effect.gen(function* () {
      const hooks = yield* install()
      const event = yield* hooks.trigger("tool", "execute.after", {
        ...toolEvent(""),
        status: "error",
        error: new Tool.Error({ message: `failed with ${PASTED}` }),
      } as ToolHooks["execute.after"])
      if (event.status !== "error") throw new Error("expected an error event")
      expect(event.error.message).toBe("failed with <API_KEY>")
    }),
  )

  it.effect("strips secret env from shells, honouring keep-env, and redacts what it took", () =>
    Effect.gen(function* () {
      const hooks = yield* install()
      const event = yield* hooks.trigger("shell", "create.before", {
        command: "printenv",
        cwd: dir,
        timeout: 0,
        shell: "/bin/sh",
        env: { PATH: "/usr/bin", GENIX_API_KEY: "session-only-key-12345", GH_TOKEN: "gh-kept" },
      })
      expect(event.env).toEqual({ PATH: "/usr/bin", GH_TOKEN: "gh-kept" })

      const after = yield* hooks.trigger("tool", "execute.after", toolEvent("found session-only-key-12345"))
      if (after.status !== "completed") throw new Error("expected a completed event")
      expect(after.result.content).toBe("found <API_KEY>")
    }),
  )

  it.effect("denies reads of credential files and shell commands that name them", () =>
    Effect.gen(function* () {
      const hooks = yield* install()
      const global = paths()
      const evaluate = (action: string, resource: string) =>
        hooks.trigger("permission", "evaluate", {
          sessionID: Session.ID.make("ses_privacy"),
          action,
          resources: [resource],
          effect: "allow",
        })

      for (const file of [
        path.join(global.config, "service.json"),
        path.join(global.data, "opencode.db"),
        path.join(global.data, "opencode.db-wal"),
        files.privacy,
      ]) {
        expect((yield* evaluate("read", file.replaceAll("\\", "/"))).effect).toBe("deny")
      }
      expect((yield* evaluate("read", "src/index.ts")).effect).toBe("allow")
      expect((yield* evaluate("read", path.join(global.config, "AGENTS.md"))).effect).toBe("allow")

      expect((yield* evaluate("shell", "cat /etc/kilo.key")).effect).toBe("deny")
      expect((yield* evaluate("shell", "ls -la")).effect).toBe("allow")
    }),
  )
})

describe("sensitiveCommandMarkers", () => {
  it.effect("spells home-relative paths every way a shell would", () =>
    Effect.sync(() => {
      const markers = sensitiveCommandMarkers(["/home/u/.local/share/genixcode/opencode.db*"], "/home/u")
      expect(markers).toContain("/home/u/.local/share/genixcode/opencode.db")
      expect(markers).toContain("~/.local/share/genixcode/opencode.db")
      expect(markers).toContain("$HOME/.local/share/genixcode/opencode.db")
      expect(markers).toContain("${HOME}/.local/share/genixcode/opencode.db")
    }),
  )
})
