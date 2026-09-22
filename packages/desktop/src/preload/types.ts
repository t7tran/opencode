import type { StorageSnapshot } from "../shared/ipc-transport"
import type { WindowBootstrap } from "../shared/window-bootstrap"

export type ElectronNative = {
  // fork_change start - true when the Genix API key comes from the managed key
  // file, so the UI must not offer connect or disconnect. Read once at preload
  // time over a sync channel; see src/main/fork-policy.ts.
  forkManagedKey: boolean
  // fork_change end
  windowID: string
  bootstrap: WindowBootstrap
  storageSnapshot: Promise<StorageSnapshot>
  getPathForFile(file: File): string
}
