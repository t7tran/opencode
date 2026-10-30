import { expect, test } from "bun:test"
import { SessionSystemPrompt } from "@opencode/core/session/system-prompt"

test("renders the default system prompt instructions", () => {
  const prompt = SessionSystemPrompt.make(["edit", "read", "shell"])
  expect(prompt).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  expect(prompt).toContain("Use the edit tool for targeted changes to existing text files")
})

// fork_change start - renamed product
test("names the fork rather than upstream in every built-in system prompt", async () => {
  const templates = await Promise.all(
    ["runner/prompt/system.txt", "../plugin/system-prompt/gpt.txt", "../plugin/system-prompt/meta.txt"].map((file) =>
      Bun.file(new URL(`../src/session/${file}`, import.meta.url)).text(),
    ),
  )
  templates.forEach((template) => {
    const prompt = SessionSystemPrompt.render(template, ["edit", "shell"])
    expect(prompt).toContain("GenixCode")
    expect(prompt).not.toMatch(/opencode/i)
  })
})
// fork_change end
