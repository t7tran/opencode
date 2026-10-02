import { describe, expect, test } from "bun:test"
import { consoleReturnWindow } from "./deep-link"
import { PROTOCOL_SCHEME } from "@opencode/util/fork/brand" // fork_change - genixcode:// deep links

describe("Console return deep links", () => {
  test("reads the originating Desktop window", () => {
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/authorized?window=window-a`)).toBe("window-a") // fork_change
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/authorized?window=window%20b`)).toBe("window b") // fork_change
  })

  test("rejects unrelated and malformed links", () => {
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/other?window=window-a`)).toBeUndefined() // fork_change
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://other/authorized?window=window-a`)).toBeUndefined() // fork_change
    expect(consoleReturnWindow("https://console/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("not a url")).toBeUndefined()
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/authorized`)).toBeUndefined() // fork_change
  })
})
