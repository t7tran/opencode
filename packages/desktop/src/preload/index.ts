import { contextBridge, ipcRenderer, webUtils } from "electron"
import {
  DragCancelEvent,
  IpcTransportPort,
  StorageSnapshotChannel,
  storageSnapshotNames,
  type StorageSnapshot,
} from "../shared/ipc-transport"
import { windowBootstrapFromArguments } from "../shared/window-bootstrap"

ipcRenderer.on(IpcTransportPort, (event) => {
  const port = event.ports[0]
  if (port) window.postMessage(IpcTransportPort, "*", [port])
})

ipcRenderer.on(DragCancelEvent, () => window.dispatchEvent(new Event(DragCancelEvent)))

// fork_change start - resolved once, synchronously, so the settings pane can
// branch on it while rendering. The channel is served by
// src/main/fork-policy.ts, which owns the name as FORK_MANAGED_KEY_CHANNEL; it is
// repeated here rather than imported because importing a main-process module
// would drag ipcMain into the preload bundle.
const forkManagedKey = ((): boolean => {
  try {
    return ipcRenderer.sendSync("fork-managed-key") === true
  } catch {
    return false
  }
})()
// fork_change end

const bootstrap = windowBootstrapFromArguments(process.argv)
// Asked before the page runs, so the stores the shell reads are hydrated on the first render.
const storageSnapshot: Promise<StorageSnapshot> = ipcRenderer
  .invoke(StorageSnapshotChannel, storageSnapshotNames(bootstrap.id))
  .catch(() => ({}))

contextBridge.exposeInMainWorld("electron", {
  forkManagedKey, // fork_change
  windowID: bootstrap.id,
  bootstrap,
  storageSnapshot,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
