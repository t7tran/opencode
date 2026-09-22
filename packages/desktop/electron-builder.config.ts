import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { CustomMacSignOptions } from "app-builder-lib"
import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// fork_change start - the identity below is duplicated from
// packages/util/src/fork/brand.ts as literals on purpose: electron-builder loads
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

export function macSignOptions(options: CustomMacSignOptions): CustomMacSignOptions {
  return {
    ...options,
    optionsForFile: (file) => {
      const defaults = options.optionsForFile?.(file)
      if (file !== path.join(options.app, "Contents/Resources/opencode-cli")) return defaults ?? {}
      // The Bun CLI loads bun-pty's native library; Electron and its helpers do not need this exception.
      return { ...defaults, entitlements: path.join(packageDir, "resources/entitlements.cli.plist") }
    },
  }
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (raw === "latest") return "prod"
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
  files: [
    "out/**/*",
    "resources/**/*",
    "!resources/opencode-cli*",
    // Log export imports Zip.js as ESM. Keep index.js and lib, including its inline worker.
    "!**/node_modules/@zip.js/zip.js/dist{,/**/*}",
    "!**/node_modules/@zip.js/zip.js/{index.cjs,index.min.js,index-fflate.js,deno.json,eslint.config.mjs}",
    // Nothing executes type declarations or source maps, and every entry costs startup time: the
    // main process parses the whole asar header before it runs any JavaScript.
    "!**/node_modules/**/*.d.{ts,cts,mts}",
    "!**/node_modules/**/*.d.{ts,cts,mts}.map",
    "!**/node_modules/**/*.{js,cjs,mjs}.map",
    // These packages execute compiled JavaScript, not their sources.
    "!**/node_modules/ajv/lib{,/**/*}",
    "!**/node_modules/ajv-formats/src{,/**/*}",
    // Keep js-yaml's CommonJS sources and dist/js-yaml.mjs ESM entry, not browser bundles or its CLI.
    "!**/node_modules/js-yaml/dist/{js-yaml.js,js-yaml.min.js,*.map}",
    "!**/node_modules/js-yaml/bin{,/**/*}",
  ],
  extraResources: [
    {
      from: "resources/",
      to: "",
      // fork_change - opencode-cli.channel rides along with the version; see
      // scripts/utils.ts copyCliToResources and main/service/desktop-cli.ts.
      filter: ["opencode-cli", "opencode-cli.exe", "opencode-cli.version", "opencode-cli.channel"],
    },
  ],
  afterPack: async (context) => {
    const cli = path.join(
      context.packager.getResourcesDir(context.appOutDir),
      context.electronPlatformName === "win32" ? "opencode-cli.exe" : "opencode-cli",
    )
    const file = await stat(cli)
    if (!file.isFile() || file.size === 0) throw new Error(`Bundled CLI must be a non-empty file: ${cli}`)
    const version = path.join(path.dirname(cli), "opencode-cli.version")
    if ((await stat(version)).size === 0) throw new Error(`Bundled CLI version must be a non-empty file: ${version}`)
    // fork_change start - an empty or missing channel sends the desktop to the wrong
    // registration file, which fails as a 120 s splash-screen hang rather than an
    // error, so fail the pack instead.
    const channel = path.join(path.dirname(cli), "opencode-cli.channel")
    if ((await stat(channel)).size === 0) throw new Error(`Bundled CLI channel must be a non-empty file: ${channel}`)
    // fork_change end
  },
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    extendInfo: {
      NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
    },
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    sign: async (options) => {
      const { sign } = await import("app-builder-lib/out/codeSign/macCodeSign")
      await sign(macSignOptions(options))
    },
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
    include: path.join(packageDir, "resources", "windows", "installer.nsh"),
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
    // fork_change start - .deb only. Upstream also emits AppImage and rpm; the
    // fork distributes desktop builds internally to Debian/Ubuntu machines, so
    // the other two were build time and release weight nobody installed. Adding
    // one back means listing it here and giving it a `packageName` in
    // getConfig(): without one, electron-builder falls back to the sanitised
    // product name, which is not a valid Debian package name.
    target: ["deb"],
    // fork_change end
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    // fork_change start - no `publish` block on any channel. Upstream points beta
    // and prod at its own update feed; leaving that in place would let a Genix
    // build auto-update itself into upstream OpenCode. Fork desktop builds are
    // distributed internally, so electron-updater has no feed (see
    // src/main/constants.ts). The branded package name rides on `deb` now, which
    // is the only Linux target the fork emits.
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
    // fork_change end
  }
}

export default getConfig()
