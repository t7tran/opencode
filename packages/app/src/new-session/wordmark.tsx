import { Logo } from "@opencode/ui/logo"
import "./wordmark.css"

export function NewSessionWordmark() {
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px] text-v2-background-bg-inverse"
    >
      <div data-slot="wordmark-reveal" class="relative mx-auto w-4/5">
        <Logo class={"block aspect-[246/42] w-full opacity-[0.16]" /* fork_change - the genixcode mark is 246 wide */} />
        <Logo class={"wordmark-shimmer absolute inset-0 aspect-[246/42] w-full" /* fork_change */} />
      </div>
    </div>
  )
}
