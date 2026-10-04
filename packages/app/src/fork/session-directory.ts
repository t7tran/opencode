import { sameDirectory } from "@/workspaces/paths"

// Where a new session runs when its draft targets the local checkout — the
// "Local repository" choice, which the workspace controller calls "main".
//
// Upstream (3355c93efd, "create local sessions in project root") always uses
// the project's canonical directory, the main checkout's root. That is right
// for what it fixed: a draft opened in a linked worktree and switched to Local
// belongs in the main checkout, not in the worktree. But it also lifts a draft
// opened in a *subfolder* of the main checkout up to the repository root, which
// the CLI and TUI never do — they run where they were started. A project folder
// that lives inside a larger repository (one agent of many in a shared clone,
// one package of a monorepo) then loses its own AGENTS.md, config and agents
// the moment the first message is sent.
//
// So a draft that is already in the main checkout keeps its own directory, and
// only one in a linked worktree moves to the main checkout. Core resolves both
// sides: `directory` is the top of the checkout the draft is in, `canonical` the
// main checkout's, and the two only differ inside a linked worktree. Comparing
// them, rather than testing whether the draft sits under `canonical`, keeps
// working when worktrees are configured to live inside the repository.
//
// See FORK.md § Sessions start where the project was opened.
export function localSessionDirectory(
  currentDirectory: string,
  project: { readonly directory: string; readonly canonical: string } | undefined,
) {
  if (!project) return currentDirectory
  if (sameDirectory(project.directory, project.canonical)) return currentDirectory
  return project.canonical
}
