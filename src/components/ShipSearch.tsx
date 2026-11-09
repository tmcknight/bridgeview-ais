import { useEffect, useMemo, useRef } from "react"
import { Input } from "@headlessui/react"
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/20/solid"
import type { TrackedShip } from "../types/ais"
import { formatDistance, formatRelativeTime } from "../utils/geo"
import type { ShipLog } from "../utils/shipLog"
import { searchShips } from "../utils/shipSearch"
import FavouriteButton from "./FavouriteButton"

interface ShipSearchProps {
  query: string
  onQueryChange: (query: string) => void
  /** Every ship heard lately, not only those near the bridge */
  ships: Map<number, TrackedShip>
  log: ShipLog
  selectedShip?: TrackedShip | null
  onSelectShip?: (ship: TrackedShip) => void
  isFavourite: (mmsi: number) => boolean
  onToggleFavourite: (mmsi: number, name: string) => void
  hidden?: boolean
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
}

/**
 * Search box at the top of the side panel: finds ships by name, MMSI, IMO or
 * destination, those being heard now and those only in the ship log.
 * "/" jumps to it; Esc clears it.
 */
export default function ShipSearch({
  query,
  onQueryChange,
  ships,
  log,
  selectedShip,
  onSelectShip,
  isFavourite,
  onToggleFavourite,
  hidden = false,
}: ShipSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (hidden) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hidden])

  const trimmed = query.trim()
  const results = useMemo(() => searchShips(trimmed, ships, log), [trimmed, ships, log])
  const found = results.live.length + results.logged.length

  return (
    <div className="px-4 md:pl-20 pt-3">
      <div className="relative">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
          aria-hidden
        />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation()
              onQueryChange("")
            }
          }}
          placeholder="Search ships: name, MMSI, IMO, destination"
          aria-label="Search ships"
          title='Search ships (press "/")'
          tabIndex={hidden ? -1 : 0}
          autoComplete="off"
          spellCheck={false}
          className="w-full pl-8 pr-8 py-1.5 text-sm rounded-full bg-slate-50/90 dark:bg-slate-900/90 border border-slate-300/80 dark:border-slate-700/80 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-300/50 dark:hover:bg-slate-600/50 cursor-pointer"
            onClick={() => {
              onQueryChange("")
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            title="Clear search"
            tabIndex={hidden ? -1 : 0}
          >
            <XMarkIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>
        )}
      </div>

      {trimmed && (
        <div className="flex flex-col gap-2 pt-2" aria-live="polite">
          {trimmed.length < 2 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1">Keep typing…</p>
          ) : found === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
              No ships match “{trimmed}”.
            </p>
          ) : (
            <p className="sr-only">
              {found} {found === 1 ? "ship matches" : "ships match"}
            </p>
          )}

          {results.live.map((ship) => {
            const isSelected = selectedShip?.mmsi === ship.mmsi
            const select = (): void => onSelectShip?.(ship)
            return (
              <div
                key={ship.mmsi}
                role="button"
                tabIndex={hidden ? -1 : 0}
                aria-label={`Select ${ship.name}, ${formatDistance(ship.distanceToBridge)} from bridge`}
                aria-pressed={isSelected}
                className={`bg-slate-50/90 dark:bg-slate-900/90 border-2 rounded-lg px-3 py-2 cursor-pointer transition-colors focus:outline-none ${
                  isSelected
                    ? "border-blue-500 bg-blue-50/90 dark:bg-blue-900/30"
                    : "border-slate-300/80 dark:border-slate-700/80 hover:border-blue-400 focus:border-blue-400 dark:hover:border-blue-400 dark:focus:border-blue-400"
                }`}
                onClick={select}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    select()
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FavouriteButton
                      name={ship.name}
                      isFavourite={isFavourite(ship.mmsi)}
                      onToggle={() => onToggleFavourite(ship.mmsi, ship.name)}
                      hidden={hidden}
                    />
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                      {ship.name}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {formatDistance(ship.distanceToBridge)}
                  </span>
                </div>
                <div className="mt-1 text-[0.7rem] text-slate-600 dark:text-slate-400 truncate">
                  MMSI {ship.mmsi}
                  {ship.imo ? ` · IMO ${ship.imo}` : ""}
                  {ship.destination ? ` · To ${ship.destination}` : ""}
                </div>
              </div>
            )
          })}

          {results.logged.length > 0 && (
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 px-1 pt-1">
              In the ship log, not heard now
            </p>
          )}
          {results.logged.map((entry) => {
            const latest = entry.passages[0]
            return (
              <div
                key={entry.mmsi}
                className="bg-slate-50/90 dark:bg-slate-900/90 border-2 border-slate-300/80 dark:border-slate-700/80 rounded-lg px-3 py-2 opacity-75"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FavouriteButton
                    name={entry.name}
                    isFavourite={isFavourite(entry.mmsi)}
                    onToggle={() => onToggleFavourite(entry.mmsi, entry.name)}
                    hidden={hidden}
                  />
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                    {entry.name}
                  </span>
                </div>
                <div className="mt-1 text-[0.7rem] text-slate-600 dark:text-slate-400">
                  MMSI {entry.mmsi}
                  {latest &&
                    ` · last under the bridge ${latest.direction} ${formatRelativeTime(latest.time)}`}
                </div>
              </div>
            )
          })}

          {results.more > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
              {results.more} more; type more of the name to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
