import { expect, test } from "bun:test"
import { App } from "@opencode/core/app"
import { CLI_NAME } from "@opencode/util/fork/brand" // fork_change - renamed binary

test("formats app metadata as a user agent", () => {
  // fork_change start - every outbound user agent goes through App.useragent, so
  // this one assertion is what pins the fork's binary name across providers,
  // models.dev, websearch and webfetch. Upstream expects "opencode/...".
  expect(App.useragent(App.make({ name: "sdk", version: "1.2.3", channel: "beta" }))).toBe(
    `${CLI_NAME}/beta/1.2.3/sdk`,
  )
  // fork_change end
})
