process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"

// fork_change start - keeps the provider lock off and tests away from a real
// /etc/kilo.key; see packages/util/src/fork/test-preload.ts
import "@opencode/util/fork/test-preload"
// fork_change end
