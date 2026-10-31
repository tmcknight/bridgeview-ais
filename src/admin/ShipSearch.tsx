import { useEffect, useState } from "react"
import { searchShips } from "./api"
import type { AdminShipSummary } from "./api"

interface ShipSearchProps {
  selected: number | null
  onSelect: (mmsi: number) => void
  onError: (err: unknown) => void
}

/** Finds ships in the server's database by name, MMSI, IMO number or call sign */
export default function ShipSearch({ selected, onSelect, onError }: ShipSearchProps) {
  const [query, setQuery] = useState("")
  const [overriddenOnly, setOverriddenOnly] = useState(false)
  const [ships, setShips] = useState<AdminShipSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const id = setTimeout(() => {
      searchShips(query, overriddenOnly)
        .then((found) => {
          if (!current) return
          setShips(found)
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
  }, [query, overriddenOnly, onError])

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
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <input type="checkbox" checked={overriddenOnly} onChange={(e) => setOverriddenOnly(e.target.checked)} />
        Only ships with corrections
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <ul className="flex flex-col divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-md md:max-h-[calc(100vh-10rem)] overflow-y-auto">
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
      </ul>
    </aside>
  )
}
