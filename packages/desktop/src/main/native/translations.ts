import {
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  formatDesktopNativeMessage,
  type DesktopNativeBundle,
  type DesktopNativeKey,
} from "@opencode/app/i18n/desktop-native"

// fork_change start - native menus, dialogs and tray copy come either from this
// English fallback or from a bundle the renderer pushes over IPC. The renderer's
// dictionaries are already rebranded; the fallback is not, and neither is a
// bundle from an older renderer, so rebrand on the way out. See
// packages/core/src/fork/brand.ts.
import { rebrand } from "@opencode/util/fork/brand"
// fork_change end

let bundle: DesktopNativeBundle = { locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }

export function setNativeTranslations(next: DesktopNativeBundle) {
  if (
    next.locale === bundle.locale &&
    DESKTOP_NATIVE_KEYS.every((key) => next.messages[key] === bundle.messages[key])
  ) {
    return false
  }
  bundle = next
  return true
}

export function nativeT(key: DesktopNativeKey, params?: Record<string, string | number>) {
  return rebrand(formatDesktopNativeMessage(bundle.messages[key], params)) // fork_change
}
