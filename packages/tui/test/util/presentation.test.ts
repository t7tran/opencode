import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"
import { CLI_NAME } from "@opencode/util/fork/brand" // fork_change - renamed binary

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain(`${CLI_NAME} -s ses_123`) // fork_change - renamed binary
})
