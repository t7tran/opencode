// fork_change - new file
//
// The `/open?dir=…[&new=1]` route and the desktop's `genixcode://open?…` links.
// See open-link.ts for what the link means and FORK.md § Opening a folder from
// a link for why it exists.

import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, onCleanup, onMount, startTransition } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { pathKey } from "@/workspaces/path-key"
import {
  latestSession,
  needsHome,
  openDeepLinkRoute,
  parseOpenRequest,
  resolveOpenDirectory,
  type OpenRequest,
} from "./open-link"

// Long enough for a cold desktop sidecar; short enough that a dead server
// doesn't leave someone staring at "Opening…".
const CONNECT_TIMEOUT_MS = 30_000
// Newest first, so the first live top-level one is the answer; the extra rows
// only cover archived sessions sitting on top.
const SESSION_LOOKUP_LIMIT = 20

class OpenError extends Error {}

export function OpenRoute() {
  const [search] = useSearchParams<{ dir?: string; new?: string }>()
  const navigate = useNavigate()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  // Read once: the route replaces itself before acting, so a reload or Back
  // can't open the folder a second time.
  const request = parseOpenRequest({ dir: search.dir, new: search.new })
  // The server this page belongs to: the desktop's built-in one, or the one
  // that served the web app (listed first).
  const conn = () => servers.list.find(ServerConnection.builtin) ?? servers.list[0]
  let started = false

  const fail = (message: string) => {
    showToast({ variant: "error", title: "Couldn't open that folder", description: message })
    navigate("/", { replace: true })
  }

  const timeout = setTimeout(() => {
    if (started) return
    started = true
    fail("The server didn't connect in time.")
  }, CONNECT_TIMEOUT_MS)
  onCleanup(() => clearTimeout(timeout))

  createEffect(() => {
    if (started) return
    if (!request) {
      started = true
      return fail("The link has no `dir` to open.")
    }
    const current = conn()
    if (!current || !servers.hydrated() || !tabs.ready()) return
    const ctx = global.ensureServerCtx(current)
    if (ctx.sdk.connection.status() !== "connected") return
    started = true
    clearTimeout(timeout)
    void open(request, current, ctx).catch((error: unknown) =>
      fail(error instanceof OpenError ? error.message : `${request.dir} couldn't be opened.`),
    )
  })

  async function open(request: OpenRequest, conn: ServerConnection.Any, ctx: ServerCtx) {
    const server = ServerConnection.key(conn)
    const home = needsHome(request.dir) ? (await ctx.sdk.api.server.info()).paths.home : undefined
    const directory = resolveOpenDirectory(request.dir, home)
    if (!directory)
      throw new OpenError(
        needsHome(request.dir)
          ? "This server doesn't report its home folder, so `~` can't be expanded. Use the full path instead."
          : `${request.dir} isn't a full path. Start it with / or ~/.`,
      )
    await ctx.sdk.api.file.list({ path: directory }).catch(() => {
      throw new OpenError(`${request.dir} doesn't exist on this server, or isn't a folder.`)
    })
    const session = request.fresh ? undefined : await resume(ctx, directory)
    const draft = request.fresh
      ? undefined
      : tabs.store.find(
          (tab) => tab.type === "draft" && tab.server === server && pathKey(tab.directory) === pathKey(directory),
        )

    navigate("/", { replace: true })
    if (session) {
      void ctx.data.session.message.sync(session.id).catch(() => undefined)
      await startTransition(() => {
        ctx.data.session.remember(session)
        ctx.projects.open(directory)
        ctx.projects.touch(directory)
        tabs.select(tabs.addSessionTab({ server, sessionId: session.id }))
      })
      return
    }
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    if (draft) return tabs.select(draft)
    await tabs.newDraft({ server, directory })
  }

  return (
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <output class="text-13-regular text-text-weak" aria-live="polite">
        {request ? `Opening ${request.dir}…` : ""}
      </output>
    </div>
  )
}

async function resume(ctx: ServerCtx, directory: string): Promise<SessionInfo | undefined> {
  const page = await ctx.sdk.api.session.list({
    directory,
    parentID: null,
    order: "desc",
    limit: SESSION_LOOKUP_LIMIT,
  })
  return latestSession(page.data, directory)
}

type DeepLinkWindow = Window & { __OPENCODE__?: { deepLinks?: string[] } }

/**
 * Sends `genixcode://open?…` links the desktop main process hands this window
 * to the `/open` route. Other deep links stay queued for whoever handles them.
 */
export function OpenDeepLinks() {
  const navigate = useNavigate()
  const take = () => {
    const state = (window as DeepLinkWindow).__OPENCODE__
    const links = state?.deepLinks ?? []
    const routes = links.map((link) => [link, openDeepLinkRoute(link)] as const)
    if (state) state.deepLinks = routes.filter(([, route]) => !route).map(([link]) => link)
    // Several links in one batch would each replace the last; the newest wins.
    const route = routes.findLast(([, route]) => route)?.[1]
    if (route) navigate(route)
  }
  onMount(() => {
    take()
    window.addEventListener("opencode:deep-link", take)
    onCleanup(() => window.removeEventListener("opencode:deep-link", take))
  })
  return null
}
