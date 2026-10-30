export * as SessionSystemPrompt from "./system-prompt.js"

import { rebrand } from "@opencode/util/fork/brand" // fork_change - renamed product
import PROMPT from "./runner/prompt/system.txt"

export function make(tools: string[]) {
  return render(PROMPT, tools)
}

export function render(prompt: string, tools: string[]) {
  const instructions: string[] = []
  if (tools.includes("shell")) {
    instructions.push(
      "- Prefer dedicated tools over shell commands; fall back to the shell when a tool cannot do what you need.",
      "- Do not chain shell commands with separators like `echo \"====\";` or `printf '---'`; the output becomes noisy in a way that makes the user's side of the conversation worse.",
    )
  }
  if (tools.includes("write")) {
    instructions.push(
      "- Use the write tool to create files or completely replace their content. Prefer using the edit tool for targeted changes.",
    )
  }
  if (tools.includes("edit")) {
    instructions.push(
      "- Use the edit tool for targeted changes to existing text files. It replaces the exact text in `oldString` with `newString`, and the values must differ. By default, `oldString` must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set `replaceAll` to true to replace every occurrence.",
    )
  }
  // fork_change start - renamed product
  // Every built-in system prompt passes through here, so upstream's .txt files stay untouched. The model would
  // otherwise call itself OpenCode and look for skills and commands under upstream's config paths. The
  // placeholder is filled first because rebrand() would rename it.
  return rebrand(prompt.replace("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n")))
  // fork_change end
}
