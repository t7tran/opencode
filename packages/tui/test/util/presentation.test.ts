import { expect, test } from "bun:test"
import { epilogue } from "../../src/util/presentation"
import { CLI_NAME } from "@opencode/util/fork/brand" // fork_change - renamed binary

const rows = (text: string | undefined) =>
  Bun.stripANSI(text ?? "")
    .split("\n")
    .filter((line) => line.trim() && !/[▀▄█]/.test(line))

test("prints nothing without a session or update", () => {
  expect(epilogue({})).toBeUndefined()
})

test("formats session continuation summary", () => {
  expect(rows(epilogue({ session: { title: "A session", sessionID: "ses_123" } }))).toEqual([
    "  Session   A session",
    `  Continue  ${CLI_NAME} -s ses_123`, // fork_change - renamed binary
  ])
})

test("tells the user to start OpenCode again after an update", () => {
  expect(rows(epilogue({ updatedVersion: "2.0.0" }))).toEqual([`  Run ${CLI_NAME} to use 2.0.0`]) // fork_change - renamed binary
})

test("keeps the session continuation after an update", () => {
  expect(rows(epilogue({ session: { title: "A session", sessionID: "ses_123" }, updatedVersion: "2.0.0" }))).toEqual([
    `  Run ${CLI_NAME} to use 2.0.0`, // fork_change - renamed binary
    "  Session   A session",
    `  Continue  ${CLI_NAME} -s ses_123`, // fork_change - renamed binary
  ])
})
