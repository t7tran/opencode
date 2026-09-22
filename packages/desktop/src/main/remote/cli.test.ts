import { expect, test } from "bun:test"
import { Effect, FileSystem, Path } from "effect"
import { NodeServices } from "@effect/platform-node"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { testEffect } from "../../../../core/test/lib/effect"
import { RemoteCli } from "./cli"
import { CLI_NAME, HOME_CONFIG_DIRNAME } from "@opencode/util/fork/brand" // fork_change - renamed binary and install dir

const it = testEffect(NodeServices.layer)
// These scripts execute on the POSIX remote host, not the Windows desktop.
const posix = process.platform === "win32" ? it.live.skip : it.live

it.live(
  "resolves the beta channel and rejects unavailable or invalid metadata",
  Effect.gen(function* () {
    // fork_change start - every path and package name below is the fork's;
    // see src/main/remote/cli.ts and FORK.md § What no longer reaches upstream.
    for (const response of [
      Response.json({ version: "0.0.0-beta-19059" }),
      Response.json({ version: "2.0.0-local-123" }),
      Response.json({ version: "0.0.0-beta-19059" }, { status: 503 }),
    ]) {
      const result = yield* RemoteCli.latestBeta().pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            expect(request.url).toBe(`https://registry.npmjs.org/${CLI_NAME}/beta`) // fork_change - the fork's own npm package
            return Effect.succeed(HttpClientResponse.fromWeb(request, response))
          }),
        ),
        Effect.result,
      )
      if (response.status === 200 && result._tag === "Success") expect(result.success).toBe("0.0.0-beta-19059")
      else expect(result._tag).toBe("Failure")
    }
    // fork_change end
  }),
)

posix(
  "discovers the managed CLI by default and uses PATH only when requested",
  Effect.gen(function* () {
    // fork_change start - every path and package name below is the fork's;
    // see src/main/remote/cli.ts and FORK.md § What no longer reaches upstream.
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "remote-cli-" })
    const home = path.join(dir, "home with ' quotes")
    yield* fs.makeDirectory(path.join(home, `${HOME_CONFIG_DIRNAME}/bin`), { recursive: true })
    yield* fs.makeDirectory(path.join(dir, "bin"))
    const managed = path.join(home, `${HOME_CONFIG_DIRNAME}/bin/${CLI_NAME}`)
    const external = path.join(dir, `bin/${CLI_NAME}`)
    yield* fs.writeFileString(managed, "#!/bin/sh\nprintf 'OpenCode v2.0.0\\n'\n", { mode: 0o755 })
    yield* fs.writeFileString(external, "#!/bin/sh\nprintf 'OpenCode v2.1.0\\n'\n", { mode: 0o755 })
    const run = (script: string) =>
      spawner.string(
        ChildProcess.make("sh", ["-c", script], {
          env: { HOME: home, PATH: `${path.join(dir, "bin")}:/usr/bin:/bin` },
        }),
      )
    expect((yield* run(RemoteCli.discoverScript())).trim()).toBe(managed)
    expect((yield* run(RemoteCli.discoverScript({ fromPath: true }))).trim()).toBe(external)
    expect(RemoteCli.parseVersion(yield* run(RemoteCli.versionScript(RemoteCli.quote(managed))))).toBe("2.0.0")
    yield* fs.remove(managed)
    expect((yield* run(RemoteCli.discoverScript())).trim()).toBe("")
    expect(RemoteCli.parseVersion(yield* run(RemoteCli.versionScript(RemoteCli.quote(managed))))).toBeNull()
  }),
)
// fork_change end

// fork_change start - the fork's platform packages are unscoped genixcode-<target>;
// see packages/cli/script/fork-publish.ts.
test("pins platform-specific artifacts and rejects unsafe inputs", () => {
  expect(RemoteCli.archiveUrl("linux-x64-baseline-musl", "2.0.0-beta.1")).toBe(
    `https://registry.npmjs.org/${CLI_NAME}-linux-x64-baseline-musl/-/${CLI_NAME}-linux-x64-baseline-musl-2.0.0-beta.1.tgz`,
  )
  // fork_change end
  expect(() => RemoteCli.installScript({ version: '2.0.0"; whoami', source: { type: "installer" } })).toThrow()
  expect(() => RemoteCli.archiveUrl("linux-x64;whoami", "2.0.0")).toThrow()
})

posix(
  "downloads or uploads the same archive into managed and version-specific locations",
  Effect.gen(function* () {
    // fork_change start - every path and package name below is the fork's;
    // see src/main/remote/cli.ts and FORK.md § What no longer reaches upstream.
    // fork_change start - every path and package name below is the fork's;
    // see src/main/remote/cli.ts and FORK.md § What no longer reaches upstream.
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "remote-install-" })
    yield* fs.makeDirectory(path.join(dir, "package/bin"), { recursive: true })
    yield* fs.writeFileString(path.join(dir, `package/bin/${CLI_NAME}`), "#!/bin/sh\nprintf 'OpenCode v2.0.0\\n'\n", {
      mode: 0o755,
    })
    const archive = path.join(dir, "archive.tgz")
    expect(
      yield* spawner.exitCode(ChildProcess.make("tar", ["-czf", archive, "-C", dir, "package"], { extendEnv: true })),
    ).toBe(0)
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(Bun.file(archive)),
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
    const run = (input: Parameters<typeof RemoteCli.installScript>[0]) =>
      spawner.exitCode(
        ChildProcess.make("sh", ["-c", RemoteCli.installScript(input)], {
          env: { HOME: dir },
          extendEnv: true,
          stdin: fs.stream(archive),
        }),
      )
    expect(yield* run({ version: "2.0.0", source: { type: "download", url: server.url.href } })).toBe(0)
    expect(yield* fs.readFileString(path.join(dir, `${HOME_CONFIG_DIRNAME}/bin/${CLI_NAME}`))).toContain("2.0.0")
    expect(
      yield* run({ version: "2.0.0", directory: `${HOME_CONFIG_DIRNAME}/desktop-ssh/2.0.0`, source: { type: "archive" } }),
    ).toBe(0)
    expect(yield* fs.readFileString(path.join(dir, `${HOME_CONFIG_DIRNAME}/desktop-ssh/2.0.0/${CLI_NAME}`))).toContain("2.0.0")
    expect(yield* run({ version: "2.1.0", source: { type: "archive" } })).not.toBe(0)
    expect(yield* fs.readFileString(path.join(dir, `${HOME_CONFIG_DIRNAME}/bin/${CLI_NAME}`))).toContain("2.0.0")
    expect(yield* fs.readDirectory(path.join(dir, `${HOME_CONFIG_DIRNAME}/bin`))).toEqual([CLI_NAME])
    // fork_change end
    // fork_change end
  }),
)
