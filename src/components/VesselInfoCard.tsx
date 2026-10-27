import type { MouseEvent } from "react"
import { useVesselInfo } from "../hooks/useVesselInfo"
import type { VesselInfo } from "../types/vessel"

interface VesselInfoCardProps {
  mmsi: number
  imo?: number
  /** Details the server stored; undefined when it hasn't looked the ship up yet */
  storedInfo?: VesselInfo | null
  hidden?: boolean
}

const linkClassName =
  "hover:text-blue-500 dark:hover:text-blue-400 hover:underline transition-colors"

/**
 * Wikidata details (photo, build year, builder, tonnage) for the selected ship.
 * Renders nothing when Wikidata has no matching vessel.
 */
export default function VesselInfoCard({ mmsi, imo, storedInfo, hidden = false }: VesselInfoCardProps) {
  // Look the ship up from the browser only when the server has nothing stored
  const lookup = useVesselInfo(mmsi, imo, storedInfo === undefined)
  const { info, loading } = storedInfo === undefined ? lookup : { info: storedInfo, loading: false }

  if (loading) {
    return (
      <p className="mt-2 text-[0.65rem] text-slate-500 dark:text-slate-400 animate-pulse">
        Looking up vessel details…
      </p>
    )
  }

  if (!info) return null

  const facts = [
    info.yearBuilt ? `Built ${info.yearBuilt}` : null,
    info.builder,
    info.operator ? `Operated by ${info.operator}` : null,
    info.grossTonnage ? `${info.grossTonnage.toLocaleString()} GT` : null,
  ].filter(Boolean)

  const stopCardSelect = {
    tabIndex: hidden ? -1 : undefined,
    onClick: (e: MouseEvent) => e.stopPropagation(),
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-300/60 dark:border-slate-700/60 flex flex-col gap-1.5">
      {info.imageUrl && (
        <a
          href={info.imagePageUrl ?? info.imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="View image on Wikimedia Commons"
          {...stopCardSelect}
        >
          <img
            src={info.imageUrl}
            alt={info.name ?? "Vessel photo"}
            loading="lazy"
            className="w-full max-h-48 object-cover rounded-md bg-slate-200 dark:bg-slate-800"
          />
        </a>
      )}
      {info.description && (
        <p className="text-xs text-slate-600 dark:text-slate-300 first-letter:uppercase">
          {info.description}
        </p>
      )}
      {facts.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-300">{facts.join(" · ")}</p>
      )}
      <div className="flex gap-3 text-[0.65rem] text-slate-500 dark:text-slate-400">
        {info.wikipediaUrl && (
          <a
            href={info.wikipediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
            {...stopCardSelect}
          >
            Wikipedia
          </a>
        )}
        <a
          href={info.wikidataUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
          title="Vessel details from Wikidata"
          {...stopCardSelect}
        >
          Wikidata
        </a>
      </div>
    </div>
  )
}
