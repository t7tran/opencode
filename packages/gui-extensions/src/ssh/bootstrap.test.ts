import { expect, test } from "bun:test"
import { binaryPath, parseRegistration } from "./bootstrap"
import { RemoteCli } from "./remote-cli"
import { CLI_PACKAGE_NAME } from "@opencode/util/fork/brand" // fork_change - the fork's npm package

test("ignores stopped services and registrations that do not match the healthy endpoint", () => {
  const registration = { url: "http://127.0.0.1:1234", password: "secret", version: "2.0.0", pid: 42 }
  const frame = `OPENCODE_SSH_REGISTRATION_BEGIN\n${JSON.stringify(registration)}\nOPENCODE_SSH_REGISTRATION_END\n`
  expect(parseRegistration(`OPENCODE_SSH_STATUS=stopped\n${frame}`)).toBeUndefined()
  expect(parseRegistration(`OPENCODE_SSH_STATUS=http://127.0.0.1:9999\n${frame}`)).toBeUndefined()
  expect(
    parseRegistration(
      `OPENCODE_SSH_STATUS=${registration.url}\nOPENCODE_SSH_REGISTRATION_BEGIN\ninvalid\nOPENCODE_SSH_REGISTRATION_END\n`,
    ),
  ).toBeUndefined()
})

test("rejects unsafe versions and platforms in remote installation paths", () => {
  expect(() => binaryPath('2.0.0"; whoami')).toThrow()
  // fork_change start - the fork's platform packages are unscoped genixcode-<target>;
  // see packages/cli/script/fork-publish.ts.
  expect(RemoteCli.archiveUrl("linux-x64-baseline-musl", "2.0.0-beta.1")).toBe(
    `https://registry.npmjs.org/${CLI_PACKAGE_NAME}-linux-x64-baseline-musl/-/${CLI_PACKAGE_NAME}-linux-x64-baseline-musl-2.0.0-beta.1.tgz`,
  )
  // fork_change end
  expect(() => RemoteCli.installScript({ version: '2.0.0"; whoami', source: { type: "installer" } })).toThrow()
  expect(() => RemoteCli.archiveUrl("linux-x64;whoami", "2.0.0")).toThrow()
})
