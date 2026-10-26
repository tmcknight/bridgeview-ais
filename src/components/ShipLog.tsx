import { useEffect, useMemo, useState } from "react"
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react"
import { ArrowUpIcon, ArrowDownIcon, ChevronDownIcon, EyeIcon } from "@heroicons/react/20/solid"
import type { TrackedShip } from "../types/ais"
import { formatRelativeTime } from "../utils/geo"
import { sortShipLog, type ShipLog as ShipLogData } from "../utils/shipLog"

interface ShipLogProps {
  log: ShipLogData
  ships: Map<number, TrackedShip>
  selectedShip?: TrackedShip | null
  onSelectShip?: (ship: TrackedShip) => void
  hidden?: boolean
}

function formatPassageTime(time: string): string {
  return new Date(time).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export default function ShipLog({
  log,
  ships,
  selectedShip,
  onSelectShip,
  hidden = false,
}: ShipLogProps) {
  // Re-render every 30s to keep relative timestamps current
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const entries = useMemo(() => sortShipLog(log), [log])

  return (
    <Disclosure as="section" className="px-4 md:pl-20 pt-3">
      <DisclosureButton
        className="group flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 tracking-wide bg-slate-300/70 dark:bg-slate-700/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-400/30 dark:border-slate-500/30 shadow-sm cursor-pointer"
        tabIndex={hidden ? -1 : 0}
      >
        {entries.length > 0 ? `Ship Log (${entries.length})` : "Ship Log"}
        <ChevronDownIcon className="w-4 h-4 transition-transform group-data-open:rotate-180" />
      </DisclosureButton>
      <DisclosurePanel className="flex flex-col gap-2 pt-2">
        {entries.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
            No ships have gone under the bridge yet.
          </p>
        ) : (
          entries.map((entry) => {
            const [latest] = entry.passages
            const live = ships.get(entry.mmsi)
            const isSelected = selectedShip?.mmsi === entry.mmsi
            const DirectionIcon = latest.direction === "upbound" ? ArrowUpIcon : ArrowDownIcon
            return (
              <div
                key={entry.mmsi}
                role={live ? "button" : undefined}
                tabIndex={live && !hidden ? 0 : -1}
                aria-label={live ? `Select ${entry.name}` : undefined}
                aria-pressed={live ? isSelected : undefined}
                className={`bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-sm border-2 rounded-lg px-3 py-2 transition-colors focus:outline-none ${
                  isSelected
                    ? "border-blue-500 bg-blue-50/90 dark:bg-blue-900/30"
                    : live
                      ? "cursor-pointer border-slate-300/80 dark:border-slate-700/80 hover:border-blue-400 focus:border-blue-400 dark:hover:border-blue-400 dark:focus:border-blue-400"
                      : "border-slate-300/80 dark:border-slate-700/80"
                }`}
                onClick={live ? () => onSelectShip?.(live) : undefined}
                onKeyDown={
                  live
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          onSelectShip?.(live)
                        }
                      }
                    : undefined
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <DirectionIcon
                      className="shrink-0 w-4 h-4 text-slate-500 dark:text-slate-400"
                      aria-label={latest.direction}
                    />
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                      {entry.name}
                    </span>
                  </div>
                  <div
                    className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 whitespace-nowrap"
                    title={`Last seen ${formatPassageTime(entry.lastSeen)}`}
                  >
                    <EyeIcon className="shrink-0 w-3 h-3 text-violet-500 dark:text-violet-400" />
                    <span className="text-[0.7rem] font-semibold text-violet-700 dark:text-violet-300">
                      Seen {formatRelativeTime(entry.lastSeen)}
                    </span>
                  </div>
                </div>
                <div className="mt-1 text-[0.7rem] text-slate-600 dark:text-slate-400">
                  {latest.direction === "upbound" ? "Upbound" : "Downbound"}{" "}
                  {formatPassageTime(latest.time)}
                  {entry.passages.length > 1 && ` · ${entry.passages.length} passages`}
                </div>
              </div>
            )
          })
        )}
      </DisclosurePanel>
    </Disclosure>
  )
}
