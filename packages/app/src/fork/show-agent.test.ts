import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { defaultSettings, settingsPersistence } from "@/settings/model"

// Upstream hides the composer's agent picker unless "Show agent" is on or the
// project has a custom agent, and its custom-agent check never matches a v2 agent
// list. So a plain project gets Build only, with no way to reach Plan. The fork
// turns the setting on by default. See the fork_change in settings/model.tsx.

const decode = Schema.decodeUnknownSync(Persistence.withInitial(settingsPersistence, defaultSettings))

describe("show agent", () => {
  test("is on for a browser with no saved settings", () => {
    expect(decode({}).general.showCustomAgents).toBe(true)
  })

  test("keeps it off for someone who turned it off", () => {
    expect(decode({ general: { showCustomAgents: false } }).general.showCustomAgents).toBe(false)
  })
})
