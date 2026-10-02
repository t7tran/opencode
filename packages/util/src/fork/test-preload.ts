// fork_change - new file
//
// The one test preload every package's bunfig points at.
//
// Two fork behaviours are on by default in a real run and must be off in tests:
//
//   - The provider lock removes every provider but Genix from the provider map,
//     so upstream's provider pipeline tests would see an empty catalogue.
//   - The managed key file is read from a fixed system path, so a developer or
//     CI host that has actually been provisioned would leak a live credential
//     into test expectations.
//
// v1 only needed this in `packages/core` and `packages/opencode`. v2 spreads the
// same pipeline across core, server, cli, tui and app, so this lives in one
// module rather than as a copy per package — a copy that drifts is a test suite
// that silently starts exercising the lock.
//
// Tests that need a key file (key-file, key-seal) override KILO_FORK_KEY_FILE
// with a temp path of their own.
//
// The CLI updater is off by default too, but it is gated on a build-time
// `define` rather than the environment, so it cannot be switched here — see
// packages/cli/src/fork/policy.ts and packages/cli/test/fork-run.ts.

process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = "1"
process.env.KILO_FORK_KEY_FILE = "/nonexistent/fork-test/kilo.key"
