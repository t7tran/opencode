// fork_change - `app` is no longer read here; the updater is off unconditionally

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// fork_change start - electron-updater has no feed in this fork. Upstream points
// beta and prod at anomalyco/opencode releases; keeping that would let a Genix
// build update itself into upstream OpenCode, and the fork publishes no desktop
// release feed of its own (see FORK.md § Desktop app). The controller reports
// "disabled", which the UI already renders — the same state unpackaged and dev
// builds have always had upstream.
export const UPDATER_ENABLED = false
// fork_change end
