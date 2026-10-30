// fork_change - new file
//
// The web UI's half of Settings → General → Updates. Upstream only shows that
// section in the desktop app, where "Check for updates" means something; in a
// browser the build you get is whatever the service worker cached, so the
// equivalent control is one that drops that cache. See app-cache.ts.
//
// The copy is plain English rather than dictionary keys, like the fork's other
// screens: adding a key means touching every locale file upstream owns. That
// includes the heading — upstream moved its own Updates section into the
// built-in updater extension, and its dictionary key went with it.

import { createSignal } from "solid-js"
import { Button } from "@opencode/ui/button"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { reloadLatestVersion } from "./app-cache"

export function ForkAppCacheSection() {
  const [reloading, setReloading] = createSignal(false)

  const reload = () => {
    if (reloading()) return
    setReloading(true)
    void reloadLatestVersion()
  }

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">Updates</h3>

      <SettingsList>
        <SettingsRow
          title="Reload latest version"
          description="If GenixCode looks out of date or won't load properly, this clears the copy your browser keeps and loads the newest version from the server. Your sessions, drafts and settings stay as they are."
        >
          <Button
            data-action="settings-reload-latest-version"
            size="normal"
            variant="neutral"
            disabled={reloading()}
            onClick={reload}
          >
            {reloading() ? "Reloading…" : "Reload"}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )
}
