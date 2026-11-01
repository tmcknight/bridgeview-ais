import { useMemo } from "react"
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react"
import { ArrowUpIcon, ArrowDownIcon, ChevronDownIcon } from "@heroicons/react/20/solid"
import type { TrackedShip } from "../types/ais"
import { formatDistance, formatETA, formatSpeed } from "../utils/geo"
import { describeCargo } from "../utils/cargo"
import { getUpcomingPassages } from "../utils/upcoming"

interface UpcomingShipsProps {
  ships: Map<number, TrackedShip>
  selectedShip?: TrackedShip | null
  onSelectShip?: (ship: TrackedShip) => void
  hidden?: boolean
}

function formatClockTime(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
}

export default function UpcomingShips({
  ships,
  selectedShip,
  onSelectShip,
  hidden = false,
}: UpcomingShipsProps) {
  const passages = useMemo(() => getUpcomingPassages(ships.values()), [ships])

  return (
    <Disclosure as="section" defaultOpen className="px-4 md:pl-20 pt-3">
      <DisclosureButton
        className="group flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 tracking-wide bg-slate-300/70 dark:bg-slate-700/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-400/30 dark:border-slate-500/30 shadow-sm cursor-pointer"
        tabIndex={hidden ? -1 : 0}
      >
        {passages.length > 0 ? `${passages.length} Coming Up` : "Coming Up"}
        <ChevronDownIcon className="w-4 h-4 transition-transform group-data-open:rotate-180" />
      </DisclosureButton>
      <DisclosurePanel className="flex flex-col gap-2 pt-2">
        {passages.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
            No ships are heading for the bridge right now.
          </p>
        ) : (
          passages.map(({ ship, etaMinutes, distanceNM, direction, cargo, passing }) => {
            const isSelected = selectedShip?.mmsi === ship.mmsi
            const DirectionIcon = direction === "upbound" ? ArrowUpIcon : ArrowDownIcon
            return (
              <div
                key={ship.mmsi}
                role="button"
                tabIndex={hidden ? -1 : 0}
                aria-label={
                  passing
                    ? `Select ${ship.name}, passing under the bridge`
                    : `Select ${ship.name}, at the bridge in ${formatETA(etaMinutes)}`
                }
                aria-pressed={isSelected}
                className={`bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-sm border-2 rounded-lg px-3 py-2 cursor-pointer transition-colors focus:outline-none ${
                  isSelected
                    ? "border-blue-500 bg-blue-50/90 dark:bg-blue-900/30"
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <DirectionIcon
                      className="shrink-0 w-4 h-4 text-slate-500 dark:text-slate-400"
                      aria-label={direction}
                    />
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                      {ship.name}
                    </span>
                  </div>
                  {passing ? (
                    <span className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      Passing now
                    </span>
                  ) : (
                    <span
                      className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                      title={`Rough estimate, ${formatClockTime(etaMinutes)}`}
                    >
                      {formatETA(etaMinutes)}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[0.7rem] text-slate-600 dark:text-slate-400">
                  {direction === "upbound" ? "Upbound" : "Downbound"} ·{" "}
                  {passing
                    ? `Under the bridge · ${formatSpeed(ship.sog)}`
                    : `${formatDistance(distanceNM)} · ${formatSpeed(ship.sog)} · ~${formatClockTime(etaMinutes)}`}
                </div>
                {(ship.destination || cargo) && (
                  <div className="mt-0.5 text-[0.7rem] text-slate-500 dark:text-slate-500 truncate">
                    {ship.destination && <span>To {ship.destination}</span>}
                    {ship.destination && cargo && " · "}
                    {cargo && <span className="italic">{describeCargo(cargo)}</span>}
                  </div>
                )}
              </div>
            )
          })
        )}
        <p className="text-[0.65rem] text-slate-500 dark:text-slate-500 px-1">
          Rough times from current speed and course; cargo is a guess from the destination.
        </p>
      </DisclosurePanel>
    </Disclosure>
  )
}
