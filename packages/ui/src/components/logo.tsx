import { type ComponentProps } from "solid-js"

// fork_change start - Genix blue, matching the TUI wordmark and the run splash.
// Exposed as a CSS variable so a theme can override it; the literal is the fallback.
const BRAND = "var(--genix-brand-base, #0186CD)"
// fork_change end

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      {/* fork_change start */}
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill={BRAND} />
      {/* fork_change end */}
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      {/* fork_change start */}
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill={BRAND} />
      {/* fork_change end */}
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    // fork_change start - "genixcode" in upstream's block-letter style: "genix"
    // replaces "open" (so the wordmark is 246 wide, not 234), and the "code" half
    // is drawn in Genix blue instead of --icon-strong-base.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 246 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M6 18H18V24H6V18Z" fill="var(--icon-weak-base)" />
        <path
          d="M0 6H24V12H0V6ZM0 12H6V24H0V12ZM18 12H24V24H18V12ZM0 24H24V30H0V24ZM18 30H24V36H18V30ZM0 36H24V42H0V36Z"
          fill="var(--icon-base)"
        />
        <path d="M54 24V30H36V24H54Z" fill="var(--icon-weak-base)" />
        <path d="M54 24H36V30H54V36H30V6H54V24ZM36 18H48V12H36V18Z" fill="var(--icon-base)" />
        <path d="M78 36H66V18H78V36Z" fill="var(--icon-weak-base)" />
        <path d="M78 12H66V36H60V6H78V12ZM84 36H78V12H84V36Z" fill="var(--icon-base)" />
        <path d="M90 6H96V12H90V6ZM90 18H96V36H90V18Z" fill="var(--icon-base)" />
        <path
          d="M102 6H108V18H102V6ZM120 6H126V18H120V6ZM108 18H120V24H108V18ZM102 24H108V36H102V24ZM120 24H126V36H120V24Z"
          fill="var(--icon-base)"
        />
        <path d="M156 30H138V18H156V30Z" fill="var(--icon-weak-base)" />
        <path d="M156 12H138V30H156V36H132V6H156V12Z" fill={BRAND} />
        <path d="M180 30H168V18H180V30Z" fill="var(--icon-weak-base)" />
        <path d="M180 12H168V30H180V12ZM186 36H162V6H186V36Z" fill={BRAND} />
        <path d="M210 30H198V18H210V30Z" fill="var(--icon-weak-base)" />
        <path d="M210 12H198V30H210V12ZM216 36H192V6H210V0H216V36Z" fill={BRAND} />
        <path d="M246 24V30H228V24H246Z" fill="var(--icon-weak-base)" />
        <path d="M246 24H228V30H246V36H222V6H246V24ZM228 18H240V12H228V18Z" fill={BRAND} />
      </g>
    </svg>
    // fork_change end
  )
}
