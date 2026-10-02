#!/usr/bin/env bun
// fork_change - new file
//
// Test entry point for the CLI package.
//
// The bunfig preload sets KILO_FORK_DISABLE_PROVIDER_LOCK and KILO_FORK_KEY_FILE
// on `process.env`, which is enough for code running in the test process. It is
// *not* enough here: many of these tests spawn the CLI as a child process, and
// `Bun.spawn` inherits the environment the runner started with rather than later
// mutations to `process.env`. A child would therefore read the real
// /etc/kilo.key — and on a provisioned host `auth login` would refuse, which is
// correct behaviour and a failing test.
//
// So the variables are set *before* `bun test` starts, which puts them in the
// environment every child inherits. The preload stays for in-process code and
// for anyone running `bun test` in this package directly.

const child = Bun.spawn({
  // The updater is gated on a build-time define, not the environment, so
  // upstream's updater tests get it here rather than from the preload. They mock
  // globalThis.fetch, so enabling it still reaches nothing.
  cmd: [process.execPath, "test", "--define", "GENIX_UPDATER_ENABLED=true", ...process.argv.slice(2)],
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    KILO_FORK_DISABLE_PROVIDER_LOCK: "1",
    KILO_FORK_KEY_FILE: "/nonexistent/fork-test/kilo.key",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await child.exited)
