import { app } from "electron"
import { appId, productName } from "@opencode/util/fork/brand" // fork_change - Genix identity

type Channel = "local" | "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"
export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

// fork_change start - electron-updater has no feed in this fork. Upstream points
// beta and prod at anomalyco/opencode releases; keeping that would let a Genix
// build update itself into upstream OpenCode, and the fork publishes no desktop
// release feed of its own (see FORK.md § Desktop app). The controller reports
// "disabled", which the UI already renders — the same state unpackaged and dev
// builds have always had upstream.
export const UPDATER_ENABLED = false
// fork_change end

// fork_change start - the product name and application id come from brand.ts
// rather than upstream's literal tables, so a GenixCode install never shares an
// identity — or a user-data directory — with an OpenCode one.
const appNames: Record<string, string> = {
  dev: productName("dev"),
  beta: productName("beta"),
  prod: productName("prod"),
}
const appIDs: Record<string, string> = {
  dev: appId("dev"),
  beta: appId("beta"),
  prod: appId("prod"),
}
// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : productName("dev")
export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : appId("dev")
// fork_change end

