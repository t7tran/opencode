import { describe, expect, test } from "bun:test"
import type { ModelListOutput, ProviderListOutput } from "@opencode/client/promise"
import { normalizeProviderList } from "@/runtime/server/global-sync/utils"

// Models discovered from the Genix gateway carry no release date, so core leaves
// `time.released` at 0. Rendered as a date that is 1970-01-01, which the model
// picker reads as an old model and hides until someone turns it on. An unknown
// date has to stay unparseable for the picker's "no release date stays visible"
// rule to apply. See the fork_change in global-sync/utils.ts.

const model = (id: string, released: number) => ({
  id,
  modelID: id,
  providerID: "genix",
  name: id,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 1_000_000, output: 128_000 },
})

const normalize = (...models: ReturnType<typeof model>[]) =>
  normalizeProviderList(
    [{ id: "genix", name: "Genix", package: "@ai-sdk/openai-compatible" }] as ProviderListOutput["data"],
    models as ModelListOutput["data"],
  ).all.get("genix")?.models

describe("model release date", () => {
  test("leaves an unknown release date unparseable", () => {
    const releaseDate = normalize(model("zai/glm-5.3", 0))?.["zai/glm-5.3"]?.release_date
    expect(releaseDate).toBe("")
    expect(Number.isNaN(Date.parse(releaseDate ?? "x"))).toBe(true)
  })

  test("keeps a known release date", () => {
    const released = Date.UTC(2026, 8, 1)
    expect(normalize(model("zai/glm-5.2", released))?.["zai/glm-5.2"]?.release_date).toBe("2026-09-01")
  })
})
