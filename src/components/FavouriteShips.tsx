import { useEffect, useMemo, useState } from "react"
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react"
import { ChevronDownIcon } from "@heroicons/react/20/solid"
import type { TrackedShip } from "../types/ais"
import { describeFavourite, type Favourites } from "../utils/favourites"
import type { ShipLog } from "../utils/shipLog"
import FavouriteButton from "./FavouriteButton"

interface FavouriteShipsProps {
  favourites: Favourites
  ships: Map<number, TrackedShip>
  log: ShipLog
  selectedShip?: TrackedShip | null
  onSelectShip?: (ship: TrackedShip) => void
  onToggleFavourite: (mmsi: number, name: string) => void
  hidden?: boolean
}

/** The ships this browser has starred, on the move ones first */
export default function FavouriteShips({
  favourites,
  ships,
  log,
  selectedShip,
  onSelectShip,
  onToggleFavourite,
  hidden = false,
}: FavouriteShipsProps) {
  // Re-render every 30s to keep relative timestamps current
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // Ships being heard first (closest to the bridge first), then the rest by name
  const rows = useMemo(
    () =>
      Array.from(favourites.values())
        .map((fav) => ({ fav, ship: ships.get(fav.mmsi) }))
        .sort((a, b) => {
          if (a.ship && b.ship) return a.ship.distanceToBridge - b.ship.distanceToBridge
          if (a.ship) return -1
          if (b.ship) return 1
          return a.fav.name.localeCompare(b.fav.name)
        }),
    [favourites, ships],
  )

  if (rows.length === 0) return null
  const heard = rows.filter((r) => r.ship).length

  return (
    <Disclosure as="section" defaultOpen className="px-4 md:pl-20 pt-3">
      <DisclosureButton
        className="group flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 tracking-wide bg-slate-300/70 dark:bg-slate-700/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-400/30 dark:border-slate-500/30 shadow-sm cursor-pointer"
        tabIndex={hidden ? -1 : 0}
      >
        Favourites ({heard > 0 ? `${heard} of ${rows.length} heard` : rows.length})
        <ChevronDownIcon className="w-4 h-4 transition-transform group-data-open:rotate-180" />
      </DisclosureButton>
      <DisclosurePanel className="flex flex-col gap-2 pt-2">
        {rows.map(({ fav, ship }) => {
          const name = ship?.name ?? log.get(fav.mmsi)?.name ?? fav.name
          const isSelected = selectedShip?.mmsi === fav.mmsi
          const select = ship ? () => onSelectShip?.(ship) : undefined
          return (
            <div
              key={fav.mmsi}
              role={ship ? "button" : undefined}
              tabIndex={ship && !hidden ? 0 : -1}
              aria-label={ship ? `Select ${name}` : undefined}
              aria-pressed={ship ? isSelected : undefined}
              className={`bg-slate-50/90 dark:bg-slate-900/90 border-2 rounded-lg px-3 py-2 transition-colors focus:outline-none ${
                isSelected
                  ? "border-blue-500 bg-blue-50/90 dark:bg-blue-900/30"
                  : ship
                    ? "cursor-pointer border-slate-300/80 dark:border-slate-700/80 hover:border-blue-400 focus:border-blue-400 dark:hover:border-blue-400 dark:focus:border-blue-400"
                    : "border-slate-300/80 dark:border-slate-700/80 opacity-75"
              }`}
              onClick={select}
              onKeyDown={
                select
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        select()
                      }
                    }
                  : undefined
              }
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <FavouriteButton
                  name={name}
                  isFavourite
                  onToggle={() => onToggleFavourite(fav.mmsi, name)}
                  hidden={hidden}
                />
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                  {name}
                </span>
              </div>
              <div className="mt-1 text-[0.7rem] text-slate-600 dark:text-slate-400">
                {describeFavourite(ship, log, fav.mmsi)}
              </div>
            </div>
          )
        })}
      </DisclosurePanel>
    </Disclosure>
  )
}
