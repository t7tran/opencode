// fork_change - new file
//
// Where the MCP OAuth callback listens.
//
// Upstream always binds the callback to 127.0.0.1. That's right when the
// redirect URI is a loopback one, as it is by default: the browser and the
// agent are on the same machine, and the browser comes back to the agent's own
// loopback. It can't work when the redirect URI names another host. Then the
// browser is sent somewhere else - a reverse proxy, a tunnel - and that
// somewhere forwards to this machine's network address, where a loopback-only
// socket turns it away with "connection refused".
//
// That's the Genix workspace exactly: the agent runs in a pod, the redirect URI
// is the editor host, and the Cloudflare tunnel delivers the callback to the
// pod's address. So a non-loopback redirect URI means "something else delivers
// the callback", and the listener has to be reachable by it.
//
// Listening on every address is less of a door than it sounds. The listener
// only exists while a sign-in is in progress, answers only the redirect URI's
// path, and won't take a code without the attempt's random state. Keeping
// other hosts away from the port is left to whatever routes to it (in the
// workspace, the pod's network policy lets only the tunnel in).
//
// See FORK.md § MCP OAuth callback behind a proxy.

import { isLoopbackHostname } from "./server-auth.js"

/**
 * The address the MCP OAuth callback listens on for this redirect URI: upstream's
 * 127.0.0.1 for no redirect URI or a loopback one, every IPv4 address otherwise.
 */
export function mcpOAuthCallbackHost(redirect: URL | undefined): string {
  if (!redirect || isLoopbackHostname(redirect.hostname)) return "127.0.0.1"
  return "0.0.0.0"
}
