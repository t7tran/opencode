// fork_change - new file
//
// Persona folders: an agent's own folder, opened as that agent.
//
// A persona folder's genixcode.json disables the built-in Build and Plan agents,
// so the persona is the only one to talk to (the workspace's agent installer and
// new-agent both write it that way). Disabled agents are removed from the
// folder's agent list on the server, so "no Build" is how the UI tells one apart.
//
// Such a folder usually sits inside a shared git clone (~/agents is one), which
// makes the new-session screen offer a project picker and a branch/workspace
// picker. Both take you away from the agent: another project isn't this agent,
// and a new workspace is a worktree of the whole clone, whose session starts at
// the clone's root, where the persona's AGENTS.md and genixcode.json don't apply.
// So the new-session screen hides them there. See FORK.md § Persona folders
// keep you in the folder.

import { normalizeAgentList } from "@/runtime/server/global-sync/utils"

/** The agent every folder has unless its config disables it (core's `Agent.defaultID`). */
const BUILD_AGENT = "build"

/**
 * True once the folder's agent list has loaded and has no Build in it. An
 * unloaded or empty list says nothing about the folder, so it counts as an
 * ordinary project.
 */
export function personaFolder(agents: Parameters<typeof normalizeAgentList>[0] | undefined) {
  if (!agents?.length) return false
  return !normalizeAgentList(agents).some((agent) => agent.name === BUILD_AGENT)
}
