import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Updater } from "../../services/updater"
import { handlePromptErrors } from "../../ui/prompt"
import { OPENCODE_VERSION } from "../../version"
import { PRODUCT_NAME } from "@opencode/util/fork/brand" // fork_change - renamed product
import { forkUpdaterEnabled, forkUpgradeRefusal } from "../../fork/policy" // fork_change - no self-update

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("cli.upgrade")(function* (input) {
    // fork_change start - refuse before the prompt UI starts, so the user gets
    // the supported command instead of a failed update check. Enforced in the
    // updater service regardless; see src/fork/policy.ts.
    if (!forkUpdaterEnabled()) return yield* Effect.fail(new Error(forkUpgradeRefusal()))
    // fork_change end
    intro("Upgrade")
    const updater = yield* Updater.Service
    const method = Option.getOrUndefined(input.method) ?? (yield* updater.method())
    if (!method)
      return yield* Effect.fail(
        new Error(`Could not detect the installation method. Pass --method to choose how to upgrade ${PRODUCT_NAME}.`), // fork_change - renamed product
      )

    log.info(`Using method: ${method}`)
    const target = Option.getOrUndefined(input.target) ?? (yield* updater.latest())
    const version = target.trim().replace(/^v/, "")
    if (version === OPENCODE_VERSION) {
      log.warn(`${PRODUCT_NAME} upgrade skipped: ${version} is already installed`) // fork_change
      outro("Done")
      return
    }

    log.info(`From ${OPENCODE_VERSION} → ${version}`)
    const progress = spinner()
    progress.start("Upgrading...")
    yield* updater.upgrade(method, target).pipe(
      Effect.tap(() => Effect.sync(() => progress.stop("Upgrade complete"))),
      Effect.tapCause(() => Effect.sync(() => progress.stop("Upgrade failed", 1))),
    )
    outro("Done")
  }, handlePromptErrors),
)
