import { useState } from "react"
import type { FormEvent } from "react"
import { searchPhotos } from "./api"
import type { VesselPhoto } from "../types/vessel"

interface PhotoSearchProps {
  /** Starting search: the ship's name */
  initialQuery: string
  /** URLs of the ship's photos already, so they aren't added twice */
  existing: Set<string>
  busy: boolean
  onAdd: (photo: VesselPhoto) => Promise<unknown>
  onError: (err: unknown) => void
}

function credit(photo: VesselPhoto): string {
  return [photo.artist, photo.license].filter(Boolean).join(" · ")
}

/**
 * Searches Wikimedia Commons for photos the lookups missed (filed under a
 * former name, or outside the ship's IMO category); each can be added with its
 * credit and licence.
 */
export default function PhotoSearch({ initialQuery, existing, busy, onAdd, onError }: PhotoSearchProps) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<VesselPhoto[] | null>(null)
  const [searching, setSearching] = useState(false)

  const search = async (e: FormEvent) => {
    e.preventDefault()
    setSearching(true)
    try {
      setResults(await searchPhotos(query.trim()))
    } catch (err) {
      onError(err)
    } finally {
      setSearching(false)
    }
  }

  const inputClass =
    "w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
  const smallButton =
    "px-2 py-1 rounded text-xs border border-slate-300 dark:border-slate-600 hover:border-blue-500 disabled:opacity-50"

  return (
    <div className="flex flex-col gap-2 p-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600">
      <h4 className="text-sm font-medium">Find photos on Wikimedia Commons</h4>
      <p className="text-xs text-slate-500">
        Try the ship's name, a former name or its IMO number. Check each photo shows this ship before adding it.
      </p>
      <form onSubmit={search} className="flex flex-col sm:flex-row gap-2">
        <input
          className={inputClass}
          type="search"
          aria-label="Search Wikimedia Commons"
          placeholder="Ship name, former name or IMO number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className={smallButton} disabled={searching || query.trim().length < 2}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {results?.length === 0 && <p className="text-sm text-slate-500">No photos found.</p>}
      {results && results.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {results.map((photo) => {
            const added = existing.has(photo.url)
            return (
              <li key={photo.url} className="flex flex-col gap-1 p-1.5 rounded border border-slate-200 dark:border-slate-700">
                <a href={photo.pageUrl ?? photo.url} target="_blank" rel="noopener noreferrer" title={photo.title}>
                  <img src={photo.url} alt={photo.title ?? ""} loading="lazy" className="w-full aspect-video object-cover rounded bg-slate-200 dark:bg-slate-800" />
                </a>
                <p className="text-xs break-words">{photo.title}</p>
                {credit(photo) && <p className="text-xs text-slate-500 break-words">{credit(photo)}</p>}
                <button type="button" className={smallButton} disabled={busy || added} onClick={() => onAdd(photo)}>
                  {added ? "Added" : "Add"}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
