interface ShipShapeProps {
  /** Overall length in metres (AIS Dimension A + B) */
  length?: number
  /** Beam in metres (AIS Dimension C + D) */
  width?: number
}

// A 1,000-footer, the longest ships on the Great Lakes, fills the full drawing width
const MAX_LENGTH_M = 310
const MAX_DRAW_PX = 56
const HEIGHT_PX = 12

// Top-down hull outline drawn to the ship's length and beam, sized against the
// biggest lakers so a tug looks small next to a freighter. Hidden when either
// measurement is missing (AIS sends 0 for "not available").
export default function ShipShape({ length, width }: ShipShapeProps) {
  if (!length || !width || length <= 0 || width <= 0) return null

  const hullLength = Math.max(10, (Math.min(length, MAX_LENGTH_M) / MAX_LENGTH_M) * MAX_DRAW_PX)
  const hullWidth = Math.min(HEIGHT_PX, Math.max(3, hullLength * (width / length)))
  const bow = Math.min(hullWidth * 1.2, hullLength * 0.4)
  const top = (HEIGHT_PX - hullWidth) / 2
  const bottom = top + hullWidth
  const mid = HEIGHT_PX / 2
  // Square stern on the left, pointed bow on the right
  const path = `M0 ${top} H${hullLength - bow} Q${hullLength} ${top} ${hullLength} ${mid} Q${hullLength} ${bottom} ${hullLength - bow} ${bottom} H0 Z`

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 whitespace-nowrap"
      title={`Length ${length} m × beam ${width} m`}
    >
      <svg
        width={MAX_DRAW_PX}
        height={HEIGHT_PX}
        viewBox={`0 0 ${MAX_DRAW_PX} ${HEIGHT_PX}`}
        className="shrink-0"
        aria-hidden="true"
      >
        <path
          d={path}
          className="fill-slate-400 stroke-slate-600 dark:fill-slate-500 dark:stroke-slate-300"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {length} × {width} m
      </span>
    </div>
  )
}
