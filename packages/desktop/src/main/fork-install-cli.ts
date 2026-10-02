// fork_change - new file
//
// "Install CLI" for the desktop app (macOS only, like upstream's).
//
// Upstream pipes the repository's root `install` script into bash with
// `--binary <bundled CLI>`. That script hard-codes `APP=opencode` and
// `INSTALL_DIR=$HOME/.opencode/bin`, so on this build it copied the Genix
// binary to `~/.opencode/bin/opencode` — over the top of a real OpenCode
// install, if there was one — while desktop-cli.ts told the user it had gone to
// `~/.genixcode/bin/genixcode`. The script is left alone (FORK.md § CLI name);
// this does the two things it did for a local binary, under the fork's names.

import { chmod, copyFile, mkdir, readFile, appendFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { CLI_NAME, HOME_CONFIG_DIRNAME } from "@opencode/util/fork/brand"

/** Copies the bundled CLI into the per-user bin dir and returns its path. */
export async function installForkCli(binary: string, home: string): Promise<string> {
  const directory = path.join(home, HOME_CONFIG_DIRNAME, "bin")
  const target = path.join(directory, CLI_NAME)
  await mkdir(directory, { recursive: true })
  await copyFile(binary, target)
  await chmod(target, 0o755)
  await addToPath(home, directory)
  return target
}

// The same rc files upstream's installer edits, and only ones that already
// exist; a line already naming the directory is left as it is.
async function addToPath(home: string, directory: string) {
  const files = [
    { file: path.join(home, ".config", "fish", "config.fish"), line: `fish_add_path ${directory}` },
    { file: path.join(home, ".zshrc"), line: `export PATH=${directory}:$PATH` },
    { file: path.join(home, ".bashrc"), line: `export PATH=${directory}:$PATH` },
    { file: path.join(home, ".bash_profile"), line: `export PATH=${directory}:$PATH` },
  ]
  for (const { file, line } of files) {
    if (!existsSync(file)) continue
    const current = await readFile(file, "utf8").catch(() => undefined)
    if (current === undefined || current.includes(directory)) continue
    await appendFile(file, `\n# ${CLI_NAME}\n${line}\n`)
  }
}
