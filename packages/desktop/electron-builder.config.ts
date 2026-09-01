import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// fork_change start - the identity below is duplicated from
// packages/core/src/fork/brand.ts as literals on purpose: electron-builder loads
// this file with its own TypeScript loader, outside bun and outside the
// workspace resolver, so a workspace import here is not safe to rely on.
// electron-builder.config.test.ts asserts the two stay in step.
//
// Upstream's legacy "opencode-desktop" launcher entry is gone: it existed only
// to keep GNOME/KDE pins working across an upstream app-id change, and this fork
// never shipped under that id.
const PRODUCT_NAME = "GenixCode"
const APP_ID_BASE = "com.genixventures.genixcode"
const PROTOCOL_SCHEME = "genixcode"
const PACKAGE_NAME = "genixcode"
// fork_change end

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

// fork_change start - Genix application ids replace ai.opencode.desktop*
const APP_IDS = {
  dev: `${APP_ID_BASE}.dev`,
  beta: `${APP_ID_BASE}.beta`,
  prod: APP_ID_BASE,
} as const
// fork_change end

const getBase = (appId: string): Configuration => ({
  artifactName: "genixcode-desktop-${os}-${arch}.${ext}", // fork_change - renamed artefacts
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "com.genixventures.genixcode" becomes // fork_change
  // "com.genixventures.genixcode.desktop". // fork_change - renamed app id
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*"], // fork_change - no bundled upstream CLI to exclude
  // fork_change start - upstream also bundles a prebuilt "opencode-cli" (the v2
  // sidecar) from its own npm packages. That binary is not built from this fork,
  // so it carries neither the provider lock nor the managed key file: shipping it
  // would put an unlocked agent next to a locked one. The v2 sidecar is disabled
  // in src/main/index.ts and nothing is bundled here.
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  // fork_change end
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: PRODUCT_NAME, // fork_change
    schemes: [PROTOCOL_SCHEME], // fork_change - genixcode:// replaces opencode://
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    // fork_change - .deb only. Upstream also emits AppImage and rpm; the fork
    // distributes desktop builds internally to Debian/Ubuntu machines, so the
    // other two were build time and release weight nobody installed. Adding one
    // back means listing it here and giving it a `packageName` in getConfig().
    target: ["deb"],
  },
})

// fork_change start - no `publish` block on any channel. Upstream points beta and
// prod at anomalyco/opencode releases; leaving that in place would let a Genix
// build auto-update itself into upstream OpenCode. Fork desktop builds are
// distributed internally, so electron-updater has no feed (see src/main/constants.ts).
function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: `${PRODUCT_NAME} Dev`,
        deb: { packageName: `${PACKAGE_NAME}-dev`, fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: `${PRODUCT_NAME} Beta`,
        protocols: { name: `${PRODUCT_NAME} Beta`, schemes: [PROTOCOL_SCHEME] },
        deb: { packageName: `${PACKAGE_NAME}-beta`, fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: PRODUCT_NAME,
        protocols: { name: PRODUCT_NAME, schemes: [PROTOCOL_SCHEME] },
        deb: { packageName: PACKAGE_NAME, fpm: [metainfoFpm(appId)] },
      }
    }
  }
}
// fork_change end

export default getConfig()
