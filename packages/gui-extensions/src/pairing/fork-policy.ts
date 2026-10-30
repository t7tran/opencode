// fork_change - new file
//
// The pairing extension's fork policy. Every desktop pairing goes through remote access — the page turns the
// service's public tunnel on as soon as it opens — and this fork keeps that tunnel off (`forkRemoteAccessEnabled()`
// in packages/cli/src/fork/policy.ts). Extensions share only contracts, so this cannot import the CLI's policy and
// repeats its answer. Pairing on the local network stays available from the CLI (`genixcode-cli pair`).
// See FORK.md § Remote access is off.

/** Whether the desktop's pairing page and command exist at all. */
export function forkPairingEnabled(): boolean {
  return false
}
