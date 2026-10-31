import type { MouseEvent } from "react"
import { useVesselInfo } from "../hooks/useVesselInfo"
import type { UscgInspections, VesselInfo } from "../types/vessel"
import { vesselPhotos } from "../utils/vesselInfo"
import PhotoCarousel from "./PhotoCarousel"

interface VesselInfoCardProps {
  mmsi: number
  imo?: number
  /** Details the server stored; undefined when it hasn't looked the ship up yet */
  storedInfo?: VesselInfo | null
  hidden?: boolean
}

const PSIX_URL = "https://cgmix.uscg.mil/psix/"
const TC_REGISTER_URL = "https://open.canada.ca/data/en/dataset/bf00b7f4-e370-46b7-94e4-0bdedc98531b"

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** "38 USCG inspections since 2023 · last Aug 3, 2026 (Detroit, Michigan): 1 deficiency" */
function inspectionSummary(inspections: UscgInspections): string {
  const last = inspections.recent[0]
  const parts = [`${plural(inspections.count, "USCG inspection")} since ${inspections.sinceYear}`]
  if (last) {
    const date = new Date(last.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    const found = last.deficiencies > 0 ? plural(last.deficiencies, "deficiency", "deficiencies") : "no deficiencies"
    parts.push(`last ${date}${last.zone ? ` (${last.zone})` : ""}: ${found}`)
  }
  return parts.join(" · ")
}

const linkClassName =
  "hover:text-blue-500 dark:hover:text-blue-400 hover:underline transition-colors"

/**
 * Vessel details for the selected ship: photo, builder and operator from
 * Wikidata; build year, tonnage, service type and registry from the USCG and
 * Transport Canada registers. Renders nothing when no source has the ship.
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

  const { registry, uscg } = info
  const photos = vesselPhotos(info)
  const inspections = uscg?.inspections
  // Across the detailed (most recent) inspections
  const unresolved = inspections?.recent.reduce((n, i) => n + i.unresolved, 0) ?? 0
  const controls = inspections?.recent.reduce((n, i) => n + i.controls, 0) ?? 0
  const service = uscg?.serviceType
    ? [uscg.serviceType, uscg.serviceSubType].filter(Boolean).join(", ")
    : null
  const facts = [
    info.yearBuilt ? `Built ${info.yearBuilt}` : null,
    info.builder,
    info.operator ? `Operated by ${info.operator}` : null,
    service,
    info.grossTonnage ? `${info.grossTonnage.toLocaleString()} GT` : null,
    uscg?.deadweight ? `${uscg.deadweight.toLocaleString()} DWT` : null,
    registry?.enginePowerKw ? `${registry.enginePowerKw.toLocaleString()} kW` : null,
    registry?.portOfRegistry ? `Registered in ${titleCase(registry.portOfRegistry)}` : null,
  ].filter(Boolean)

  const stopCardSelect = {
    tabIndex: hidden ? -1 : undefined,
    onClick: (e: MouseEvent) => e.stopPropagation(),
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-300/60 dark:border-slate-700/60 flex flex-col gap-1.5">
      <PhotoCarousel
        key={mmsi}
        photos={photos}
        alt={info.name ?? "Vessel photo"}
        imageClassName="w-full max-h-48 object-cover rounded-md bg-slate-200 dark:bg-slate-800"
        hidden={hidden}
      />
      {info.description && (
        <p className="text-xs text-slate-600 dark:text-slate-300 first-letter:uppercase">
          {info.description}
        </p>
      )}
      {facts.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-300">{facts.join(" · ")}</p>
      )}
      {inspections && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {inspectionSummary(inspections)}
          {unresolved > 0 && (
            <span className="text-amber-600 dark:text-amber-400"> · {plural(unresolved, "open deficiency", "open deficiencies")}</span>
          )}
          {controls > 0 && (
            <span className="text-red-600 dark:text-red-400"> · {plural(controls, "operational control")}</span>
          )}
        </p>
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
        {info.wikidataUrl && (
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
        )}
        {uscg && (
          <a
            href={PSIX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
            title={`US Coast Guard Port State Information Exchange (vessel ID ${uscg.vesselId})`}
            {...stopCardSelect}
          >
            USCG
          </a>
        )}
        {registry && (
          <a
            href={TC_REGISTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
            title={[
              "Transport Canada vessel register",
              registry.officialNumber && `official number ${registry.officialNumber}`,
              registry.hullNumber && `hull ${registry.hullNumber}`,
            ]
              .filter(Boolean)
              .join(", ")}
            {...stopCardSelect}
          >
            Transport Canada
          </a>
        )}
      </div>
    </div>
  )
}
