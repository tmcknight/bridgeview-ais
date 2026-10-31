import { useEffect, useState } from "react"
import { PhotoIcon } from "@heroicons/react/24/outline"
import { SHIP_TYPE_FILTERS, searchShips } from "./api"
import type { AdminShipSummary, ShipTypeFilter } from "./api"

interface ShipSearchProps {
  selected: number | null
  onSelect: (mmsi: number) => void
  onError: (err: unknown) => void
}

/** Finds ships in the server's database by name, MMSI, IMO number or call sign, and by type */
export default function ShipSearch({ selected, onSelect, onError }: ShipSearchProps) {
  const [query, setQuery] = useState("")
  const [overriddenOnly, setOverriddenOnly] = useState(false)
  const [type, setType] = useState<ShipTypeFilter | "">("")
  const [ships, setShips] = useState<AdminShipSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const id = setTimeout(() => {
      searchShips({ query, overriddenOnly, type })
        .then((found) => {
          if (!current) return
          setShips(found.ships)
          setTotal(found.total)
          setError(null)
        })
        .catch((err) => {
          if (!current) return
          setError(err instanceof Error ? err.message : "Search failed")
          onError(err)
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(id)
    }
  }, [query, overriddenOnly, type, onError])

  const showMore = () => {
    setLoadingMore(true)
    searchShips({ query, overriddenOnly, type, offset: ships.length })
      .then((found) => {
        // Ships heard since the first page can shift the order; skip repeats
        setShips((shown) => {
          const seen = new Set(shown.map((ship) => ship.mmsi))
          return [...shown, ...found.ships.filter((ship) => !seen.has(ship.mmsi))]
        })
        setTotal(found.total)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Search failed")
        onError(err)
      })
      .finally(() => setLoadingMore(false))
  }

  return (
    <aside className="md:w-80 shrink-0 flex flex-col gap-2">
      <input
        type="search"
        placeholder="Name, MMSI, IMO or call sign"
        aria-label="Search ships"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
      />
      <select
        aria-label="Ship type"
        value={type}
        onChange={(e) => setType(e.target.value as ShipTypeFilter | "")}
        className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
      >
        <option value="">All ship types</option>
        {SHIP_TYPE_FILTERS.map((filter) => (
          <option key={filter.value} value={filter.value}>
            {filter.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <input type="checkbox" checked={overriddenOnly} onChange={(e) => setOverriddenOnly(e.target.checked)} />
        Only ships with corrections
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {total > 0 && (
        <p className="text-xs text-slate-500">
          {ships.length < total ? `Showing ${ships.length} of ${total} ships` : `${total} ${total === 1 ? "ship" : "ships"}`}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-md md:max-h-[calc(100vh-14rem)] overflow-y-auto">
        {ships.length === 0 && <li className="p-3 text-sm text-slate-500">No ships found</li>}
        {ships.map((ship) => (
          <li key={ship.mmsi}>
            <button
              type="button"
              onClick={() => onSelect(ship.mmsi)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                selected === ship.mmsi ? "bg-blue-50 dark:bg-slate-800" : ""
              }`}
            >
              <span className="font-medium">{ship.name ?? `MMSI ${ship.mmsi}`}</span>
              {ship.photoCount > 0 && (
                <PhotoIcon
                  className="inline-block ml-1.5 w-4 h-4 align-text-bottom text-slate-400"
                  title={`${ship.photoCount} ${ship.photoCount === 1 ? "photo" : "photos"}`}
                />
              )}
              {ship.overridden && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">edited</span>
              )}
              <span className="block text-xs text-slate-500">
                {ship.mmsi}
                {ship.imo ? ` · IMO ${ship.imo}` : ""}
                {ship.length ? ` · ${ship.length} m` : ""}
                {ship.found ? "" : " · no lookup match"}
              </span>
            </button>
          </li>
        ))}
        {ships.length < total && (
          <li>
            <button
              type="button"
              onClick={showMore}
              disabled={loadingMore}
              className="w-full px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          </li>
        )}
      </ul>
    </aside>
  )
}
