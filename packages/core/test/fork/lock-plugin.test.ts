// The provider lock's v2 wiring (packages/core/src/fork/plugin.ts) against
// upstream's config plugin, with a managed key in place.
//
// Each case is a way an opencode.json entry, or a plugin removal directive,
// used to get past the lock on top of v2.0.21. They run the real
// ConfigProviderPlugin first and the lock second, the order internal.ts
// registers them in, so a rebase that moves either one shows up here.

import { afterEach, beforeEach, describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Effect, Schema } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { ForkLockPlugin } from "@opencode/core/fork/plugin"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { guarded } from "@opencode/core/plugin/internal"
import { Provider } from "@opencode/core/provider"
import { clearGatewayModelCache } from "@opencode/util/fork/gateway"
import { lockedProvider } from "@opencode/util/fork/lock"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)

const MANAGED_KEY = "sk-managed-test-key"
const ATTACKER = "https://attacker.invalid/v1"
const GENIX = Provider.ID.make(lockedProvider().id)

let dir: string
let keyFile: string
const realFetch = globalThis.fetch

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-lock-plugin-"))
  keyFile = path.join(dir, "kilo.key")
  fs.writeFileSync(keyFile, MANAGED_KEY)
  clearGatewayModelCache()
  // Discovery runs whenever a key is managed; answer it locally with one model.
  globalThis.fetch = (async () =>
    Response.json({ data: [{ id: "discovered" }] })) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  clearGatewayModelCache()
  fs.rmSync(dir, { recursive: true, force: true })
})

const locked = <A, E, R>(effect: () => Effect.Effect<A, E, R>) =>
  withEnv({ GENIXCODE_FORK_DISABLE_PROVIDER_LOCK: undefined, GENIXCODE_FORK_KEY_FILE: keyFile }, effect)

const install = Effect.fn(function* (entries: Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer(entries)))
  yield* ForkLockPlugin.effect(host)
})

const config = (info: unknown) => [new Document({ type: "document", info: decode(info) })]

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("ForkLockPlugin with a managed key", () => {
  it.effect("re-pins package, baseURL and the key on every model and variant", () =>
    locked(() =>
      Effect.gen(function* () {
        yield* install(
          config({
            providers: {
              genix: {
                models: {
                  m: {
                    package: "evil-package",
                    settings: { baseURL: ATTACKER, apiKey: "user-key" },
                    variants: [{ id: "fast", settings: { baseURL: ATTACKER } }],
                  },
                },
              },
            },
          }),
        )
        const model = required(yield* (yield* Model.Service).get(GENIX, Model.ID.make("m")))
        expect(model.package).toBe(lockedProvider().npm)
        expect(model.settings?.baseURL).toBe(lockedProvider().baseURL)
        expect(model.settings?.apiKey).toBe(MANAGED_KEY)
        const variant = required(model.variants?.find((item) => item.id === "fast"))
        expect(variant.settings?.baseURL).toBe(lockedProvider().baseURL)
      }),
    ),
  )

  it.effect("points the provider at an integration no credential can be stored under", () =>
    locked(() =>
      Effect.gen(function* () {
        yield* install(config({ providers: { genix: { env: ["FORK_TEST_GENIX_KEY"] } } }))
        const provider = required(yield* (yield* Provider.Service).get(GENIX))
        // The env method config added lands on the `genix` integration, which a
        // managed provider no longer resolves against.
        expect(String(provider.integrationID)).toBe("fork.genix.managed")
        expect(provider.activation).toBe("enabled")
        expect(provider.settings?.apiKey).toBe(MANAGED_KEY)
        const available = yield* (yield* Model.Service).available()
        expect(available.some((model) => model.providerID === GENIX)).toBe(true)
      }),
    ),
  )
})

describe("ForkLockPlugin and MCP", () => {
  it.effect("leaves MCP servers' integrations alone while pruning other providers'", () =>
    locked(() =>
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const mcp = Integration.ID.make("mcp_0123456789abcdef")
        const other = Integration.ID.make("openai")
        // Registered before the lock, so the lock's prune sees both.
        yield* integrations.transform((editor) => {
          editor.update(mcp, (ref) => {
            ref.name = "docs"
            ref.metadata = { source: "mcp" }
          })
          editor.update(other, (ref) => {
            ref.name = "OpenAI"
          })
        })
        yield* install([])
        expect(yield* integrations.get(mcp)).toBeDefined()
        expect(yield* integrations.get(other)).toBeUndefined()
      }),
    ),
  )
})

describe("ForkLockPlugin registration", () => {
  it.effect("cannot be removed by a config plugin directive", () =>
    Effect.sync(() => {
      expect(guarded.has(ForkLockPlugin.id)).toBe(true)
    }),
  )
})
