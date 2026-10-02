// fork_change - new file
//
// The provider lock, as a v2 plugin.
//
// Upstream v1 let the fork splice two entries into the `configProviders` array
// that provider state init folded over: a *head* entry carrying the locked
// identity (merged under user config, so opencode.json could still refine the
// name and model list) and a *tail* entry carrying the managed API key and the
// gateway URL (merged over user config, so neither could be shadowed).
//
// v2 has no such array. Providers are records in a State map, and every
// contributor — including upstream's own config provider plugin — mutates them
// through `ctx.provider.transform`. Transforms are applied in plugin
// registration order, so registering this plugin after `ConfigProviderPlugin`
// reproduces the v1 tail's precedence exactly, and the same transform can do
// the head's job by filling in whatever user config did not set.
//
// What it does, in one fold:
//
//   1. Drops every provider that is not the locked one. This is the hard lock:
//      `provider.remove` takes the record out of the map, so it is not merely
//      hidden — no model of it can be resolved.
//   2. Upserts the locked provider with its hardcoded identity, package and
//      base URL, keeping any name/settings the user supplied for it.
//   3. When a managed key file is present, re-applies the key and the base URL
//      over user config, pins the package, and forces `activation: "enabled"`
//      so a stale `disabled_providers` entry (a disconnect performed before the
//      file was dropped in) cannot keep it disconnected.
//
// Model discovery is the other half of "always connected": the Genix gateway
// has no models.dev catalogue entry, so with no models in config the provider
// would have nothing to offer. The gateway's OpenAI-compatible `/models`
// endpoint is read once per process (see gateway.ts) and the result registered
// here. Discovery never throws — an unreachable gateway leaves whatever models
// config supplies.
//
// See FORK.md.

import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { App } from "../app.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { cachedGatewayModels } from "@opencode/util/fork/gateway"
import { keyFilePath, managedKey } from "@opencode/util/fork/key-file"
import { isLockedProvider, lockActive, lockedProvider, lockedManagedSettings } from "@opencode/util/fork/lock"

export const ForkLockPlugin = define({
  id: "fork.provider.lock",
  effect: Effect.fn(function* (ctx) {
    if (!lockActive()) return

    const locked = lockedProvider()
    const lockedID = Provider.ID.make(locked.id)
    const key = managedKey()

    // Discovery is skipped without a managed key: the interactive flow persists
    // the model list to config, so there is nothing to discover and no
    // credential to discover it with.
    const discovered = key
      ? yield* Effect.promise(() => cachedGatewayModels(locked.baseURL, key, App.useragent(ctx.app)))
      : undefined
    if (discovered?.error)
      yield* Effect.logWarning("fork: model discovery for the managed key failed", {
        file: keyFilePath(),
        err: discovered.error,
      })

    // Integrations are the connect surface: the login picker, the settings
    // provider list and the OAuth entry points all enumerate them. Pruning them
    // here is what makes those surfaces show only Genix; the server refuses the
    // rest regardless (fork/guard.ts), this stops them being offered at all.
    yield* ctx.integration.transform((integrations) => {
      for (const ref of integrations.list()) {
        if (isLockedProvider(ref.id)) continue
        integrations.remove(ref.id)
      }
    })

    yield* ctx.provider.transform((providers) => {
      for (const record of providers.list()) {
        if (record.provider.id === lockedID) continue
        providers.remove(record.provider.id)
      }

      const managed = lockedManagedSettings()
      providers.update(lockedID, (provider) => {
        provider.name = provider.name && provider.name !== lockedID ? provider.name : locked.name
        provider.package = locked.npm
        provider.integrationID = undefined
        provider.settings = {
          baseURL: locked.baseURL,
          ...provider.settings,
          provider: locked.id,
          // The managed key and its base URL go on last so an opencode.json
          // entry cannot shadow either. Without a managed key the user's own
          // credential stands, exactly as upstream wrote it.
          ...(managed ?? {}),
        }
        if (managed) provider.activation = "enabled"
      })

      for (const [id, model] of Object.entries(discovered?.models ?? {})) {
        providers.models.update(lockedID, Model.ID.make(id), (draft) => {
          draft.modelID = Model.ID.make(id)
          draft.name = model.name || id
        })
      }

      // `package` is user-settable per model as well as per provider, and the
      // package it names is loaded and handed the API key — so leaving it open
      // lets an opencode.json entry exfiltrate the managed key (and run
      // arbitrary code) without touching the key file.
      if (!managed) return
      for (const model of providers.get(lockedID)?.models.values() ?? []) {
        providers.models.update(lockedID, model.id, (draft) => {
          draft.package = locked.npm
        })
      }
    })
  }),
})
