import { createUniqueId, type ComponentProps } from "solid-js"

// fork_change start - "genixcode" replaces "opencode". The letterforms are the
// same block glyphs as the primary wordmark (Logo, in ../../components/logo.tsx)
// scaled up from its 246x42 viewBox into this component's larger canvas, since
// hand-tracing new outlines at this size would drift from that font. The canvas,
// the fade mask and the outline/muted props stay upstream's.
// See packages/util/src/fork/brand.ts.
const SCALE = 720 / 246
// fork_change end

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            {/* fork_change start */}
            <g transform={`scale(${SCALE})`}>
                <path pathLength={props.outline ? 1 : undefined} d="M6 18H18V24H6V18Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M0 6H24V12H0V6ZM0 12H6V24H0V12ZM18 12H24V24H18V12ZM0 24H24V30H0V24ZM18 30H24V36H18V30ZM0 36H24V42H0V36Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M54 24V30H36V24H54Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M54 24H36V30H54V36H30V6H54V24ZM36 18H48V12H36V18Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M78 36H66V18H78V36Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M78 12H66V36H60V6H78V12ZM84 36H78V12H84V36Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M90 6H96V12H90V6ZM90 18H96V36H90V18Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M102 6H108V18H102V6ZM120 6H126V18H120V6ZM108 18H120V24H108V18ZM102 24H108V36H102V24ZM120 24H126V36H120V24Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M156 30H138V18H156V30Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M156 12H138V30H156V36H132V6H156V12Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M180 30H168V18H180V30Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M180 12H168V30H180V12ZM186 36H162V6H186V36Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M210 30H198V18H210V30Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M210 12H198V30H210V12ZM216 36H192V6H210V0H216V36Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M246 24V30H228V24H246Z" />
                <path pathLength={props.outline ? 1 : undefined} d="M246 24H228V30H246V36H222V6H246V24ZM228 18H240V12H228V18Z" />
            </g>
            {/* fork_change end */}
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
