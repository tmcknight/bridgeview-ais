import { useMemo } from "react"
import type { TrackedShip } from "../types/ais"
import { NAV_STATUS_LABELS } from "../types/ais"
import {
  formatDistance,
  formatSpeed,
  formatHeading,
  estimatedTimeToBridge,
  formatETA,
} from "../utils/geo"
import { BoltIcon, MapPinIcon, ClockIcon } from "@heroicons/react/20/solid"
import { XMarkIcon } from "@heroicons/react/20/solid"

interface ShipListProps {
  ships: Map<number, TrackedShip>
  selectedShip?: TrackedShip | null
  onSelectShip?: (ship: TrackedShip) => void
  hidden?: boolean
  onClose?: () => void
}

export default function ShipList({
  ships,
  selectedShip,
  onSelectShip,
  hidden = false,
  onClose,
}: ShipListProps) {
  const sorted = useMemo(
    () =>
      Array.from(ships.values()).sort(
        (a, b) => a.distanceToBridge - b.distanceToBridge,
      ),
    [ships],
  )

  if (sorted.length === 0) {
    return (
      <div>
        <div className="sticky top-0 z-10 px-4 md:pl-20 pt-3 pb-0.5 flex items-center justify-between">
          <h2 className="inline-block text-xs font-semibold text-slate-700 dark:text-slate-300 tracking-wide bg-slate-300/70 dark:bg-slate-700/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-400/30 dark:border-slate-500/30 shadow-sm">
            Tracked Vessels
          </h2>
          <button
            className="p-1 rounded hover:bg-slate-300/50 dark:hover:bg-slate-600/50 transition-colors"
            onClick={onClose}
            aria-label="Close vessel list"
            title="Close vessel list"
          >
            <XMarkIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>
        </div>
        <div className="text-center py-8 px-4 md:pl-20 text-slate-500 dark:text-slate-400">
          <p className="mb-2">No vessels detected in the tracking area.</p>
          <p className="text-xs opacity-70">
            Ships will appear here as AIS data is received from the St. Clair
            River area.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="sticky top-0 z-10 px-4 md:pl-20 pt-3 pb-0.5 flex items-center justify-between">
        <h2 className="inline-block text-xs font-semibold text-slate-700 dark:text-slate-300 tracking-wide bg-slate-300/70 dark:bg-slate-700/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-400/30 dark:border-slate-500/30 shadow-sm">
          {sorted.length} Tracked Vessels
        </h2>
        <button
          className="p-1 rounded hover:bg-slate-300/50 dark:hover:bg-slate-600/50 transition-colors"
          onClick={onClose}
          aria-label="Close vessel list"
          title="Close vessel list"
        >
          <XMarkIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        </button>
      </div>
      <div className="flex flex-col gap-2 p-4 md:pl-20">
        {sorted.map((ship) => {
          const eta = estimatedTimeToBridge(ship.distanceToBridge, ship.sog)
          const headingDeg =
            ship.trueHeading !== 511 ? ship.trueHeading : ship.cog
          const isSelected = selectedShip?.mmsi === ship.mmsi
          return (
            <div
              key={ship.mmsi}
              role="button"
              tabIndex={hidden ? -1 : 0}
              aria-label={`View details for ${ship.name}, ${formatDistance(ship.distanceToBridge)} from bridge`}
              aria-pressed={isSelected}
              className={`group bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-sm border-2 rounded-lg p-3 cursor-pointer transition-colors focus:outline-none ${
                isSelected
                  ? "border-blue-500 bg-blue-50/90 dark:bg-blue-900/30"
                  : ship.approaching
                    ? "border-red-500 hover:border-red-400 focus:border-red-400 dark:hover:border-red-400 dark:focus:border-red-400"
                    : "border-slate-300/80 dark:border-slate-700/80 hover:border-blue-400 focus:border-blue-400 dark:hover:border-blue-400 dark:focus:border-blue-400"
              }`}
              onClick={() => onSelectShip?.(ship)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelectShip?.(ship)
                }
              }}
            >
              {/* Header: icon + name + badge */}
              <div className="flex items-start justify-between mb-2">
                <div
                  className="flex items-center gap-1.5 min-w-0"
                  title={[
                    NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown",
                    ship.navStatus !== 1 && ship.navStatus !== 5
                      ? `Heading ${formatHeading(headingDeg)}`
                      : null,
                    ship.destination ? `Dest: ${ship.destination}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {(() => {
                    const isStationary =
                      ship.navStatus === 1 || ship.navStatus === 5
                    const fill = ship.approaching
                      ? "#ef4444"
                      : isStationary
                        ? "#9ca3af"
                        : "#3b82f6"
                    // Light: darker shade of fill; Dark: lighter shade of fill
                    const stroke = ship.approaching
                      ? "#b91c1c"
                      : isStationary
                        ? "#6b7280"
                        : "#1d4ed8"
                    const strokeDark = ship.approaching
                      ? "#fca5a5"
                      : isStationary
                        ? "#d1d5db"
                        : "#93c5fd"
                    return isStationary ? (
                      <svg
                        width={18}
                        height={18}
                        viewBox="0 0 24 24"
                        className="shrink-0"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="7"
                          fill={fill}
                          className="in-[.dark]:hidden"
                          stroke={stroke}
                          strokeWidth="1.5"
                        />
                        <circle
                          cx="12"
                          cy="12"
                          r="7"
                          fill={fill}
                          className="hidden in-[.dark]:block"
                          stroke={strokeDark}
                          strokeWidth="1.5"
                        />
                      </svg>
                    ) : (
                      <svg
                        width={18}
                        height={18}
                        viewBox="0 0 24 24"
                        className="shrink-0"
                        style={{ transform: `rotate(${headingDeg}deg)` }}
                      >
                        <path
                          d="M12 2 L18 20 L12 16 L6 20 Z"
                          fill={fill}
                          className="in-[.dark]:hidden"
                          stroke={stroke}
                          strokeWidth="1.5"
                        />
                        <path
                          d="M12 2 L18 20 L12 16 L6 20 Z"
                          fill={fill}
                          className="hidden in-[.dark]:block"
                          stroke={strokeDark}
                          strokeWidth="1.5"
                        />
                      </svg>
                    )
                  })()}
                  <span className="font-semibold text-base text-slate-800 dark:text-slate-100 truncate">
                    {ship.name}
                  </span>
                </div>
                {ship.approaching && (
                  <span className="shrink-0 text-[0.6rem] font-bold text-red-600 dark:text-red-400 bg-red-500/15 px-2 py-0.5 rounded tracking-wide">
                    APPROACHING
                  </span>
                )}
              </div>

              {/* Primary stats row */}
              <div className="flex flex-wrap gap-2">
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 whitespace-nowrap"
                  title="Distance to bridge"
                >
                  <MapPinIcon className="shrink-0 w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {formatDistance(ship.distanceToBridge)}
                  </span>
                </div>
                {ship.sog > 0 && (
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 whitespace-nowrap"
                    title="Speed over ground"
                  >
                    <BoltIcon className="shrink-0 w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                      {formatSpeed(ship.sog)}
                    </span>
                  </div>
                )}
                {ship.approaching && eta !== null && (
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 whitespace-nowrap"
                    title="Estimated time to bridge"
                  >
                    <ClockIcon className="shrink-0 w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {formatETA(eta)}
                    </span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 mt-2 pt-1.5 border-t border-slate-300/60 dark:border-slate-700/60 text-[0.65rem] text-slate-500 dark:text-slate-500">
                <a
                  href={`https://www.vesselfinder.com/vessels/details/${ship.mmsi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="whitespace-nowrap hover:text-blue-500 dark:hover:text-blue-400 hover:underline transition-colors"
                  title="View vessel details on VesselFinder"
                  tabIndex={hidden ? -1 : undefined}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {ship.mmsi}
                </a>
                <span className="whitespace-nowrap" title="Last update">
                  {new Date(ship.lastUpdate).toLocaleTimeString()}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
