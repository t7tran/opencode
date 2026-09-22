import { createEffect, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

// fork_change start - the About wordmark spells "genixcode", not "opencode".
// The glyph paths and the letter positions are lifted from the fork wordmark in
// packages/ui/src/components/logo.tsx so the two read as the same mark.
//
// Upstream could place letter N at `index * 30` because every glyph was 24 wide
// on a uniform pitch. "i" is 6 wide, so the positions are spelled out here, and
// the narrow slot is held out of the scramble: swapping a 24-wide glyph into it
// would run the letter straight over the "x" beside it.
const target = ["g", "e", "n", "i", "x", "c", "o", "d", "e"] as const
const choices = ["g", "e", "n", "x", "c", "o", "d"] as const
const positions = [0, 30, 60, 90, 102, 132, 162, 192, 222] as const
const NARROW = "i"
type Letter = (typeof target)[number]
const advance = (letter: Letter) => (letter === NARROW ? 6 : 24)
const scramble = (letter: Letter): Letter =>
  letter === NARROW ? letter : choices[Math.floor(Math.random() * choices.length)]
// fork_change end

export function AnimatedWordmark(props: { active: boolean }) {
  const [state, setState] = createStore({ letters: [...target] })
  const timers = new Set<ReturnType<typeof setTimeout>>()

  createEffect(
    on(
      () => props.active,
      (active) => {
        timers.forEach(clearTimeout)
        timers.clear()
        if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setState("letters", [...target])
          return
        }

        const starts = target.map((letter) => scramble(letter)) // fork_change
        const settles = target.map(() => 6 + Math.floor(Math.random() * 8))
        const last = Math.max(...settles)
        setState("letters", starts)

        Array.from({ length: last }, (_, index) => index + 1).forEach((tick) => {
          const timer = setTimeout(() => {
            setState(
              "letters",
              // fork_change start
              target.map((letter, index) => (tick >= settles[index] ? letter : scramble(letter))),
              // fork_change end
            )
            timers.delete(timer)
          }, tick * 75)
          timers.add(timer)
        })
      },
    ),
  )

  onCleanup(() => timers.forEach(clearTimeout))

  return (
    <svg class="settings-about-wordmark" viewBox={"0 0 246 42" /* fork_change - 246 wide, not 234 */} aria-hidden="true">
      <defs>
        {/* fork_change start - g, i and x replace upstream's p */}
        <symbol id="settings-about-letter-g" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M6 18H18V24H6V18Z" />
          <path d="M0 6H24V12H0V6ZM0 12H6V24H0V12ZM18 12H24V24H18V12ZM0 24H24V30H0V24ZM18 30H24V36H18V30ZM0 36H24V42H0V36Z" />
        </symbol>
        <symbol id="settings-about-letter-i" viewBox="0 0 6 42">
          <path d="M0 6H6V12H0V6ZM0 18H6V36H0V18Z" />
        </symbol>
        <symbol id="settings-about-letter-x" viewBox="0 0 24 42">
          <path d="M0 6H6V18H0V6ZM18 6H24V18H18V6ZM6 18H18V24H6V18ZM0 24H6V36H0V24ZM18 24H24V36H18V24Z" />
        </symbol>
        {/* fork_change end */}
        <symbol id="settings-about-letter-o" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 30H6V18H18V30Z" />
          <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" />
        </symbol>
        <symbol id="settings-about-letter-e" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M24 24V30H6V24H24Z" />
          <path d="M24 24H6V30H24V36H0V6H24V24ZM6 18H18V12H6V18Z" />
        </symbol>
        <symbol id="settings-about-letter-n" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 36H6V18H18V36Z" />
          <path d="M18 12H6V36H0V6H18V12ZM24 36H18V12H24V36Z" />
        </symbol>
        <symbol id="settings-about-letter-c" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M24 30H6V18H24V30Z" />
          <path d="M24 12H6V30H24V36H0V6H24V12Z" />
        </symbol>
        <symbol id="settings-about-letter-d" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 30H6V18H18V30Z" />
          <path d="M18 12H6V30H18V12ZM24 36H0V6H18V0H24V36Z" />
        </symbol>
      </defs>
      <For each={state.letters}>
        {(letter, index) => (
          // fork_change start - explicit position and width; the pitch is no longer uniform
          <use href={`#settings-about-letter-${letter}`} x={positions[index()]} width={advance(letter)} height="42" />
          // fork_change end
        )}
      </For>
    </svg>
  )
}
