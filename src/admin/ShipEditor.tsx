import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { getShip, OVERRIDE_FIELDS, refreshShip, saveOverrides } from "./api"
import type { AdminShipView, OverrideField, VesselOverrides } from "./api"
import PhotoManager from "./PhotoManager"

interface ShipEditorProps {
  mmsi: number
  onError: (err: unknown) => void
}

// How often, and for how long, to check whether a refresh has finished
const REFRESH_POLL_MS = 2000
const REFRESH_TIMEOUT_MS = 60_000

type Drafts = Partial<Record<OverrideField, string>>

function draftsFrom(overrides: VesselOverrides): Drafts {
  return Object.fromEntries(
    Object.entries(overrides.fields ?? {}).map(([key, value]) => [key, String(value)])
  ) as Drafts
}

function shown(value: unknown): string {
  return value === undefined || value === null || value === "" ? "—" : String(value)
}

/**
 * One ship's details: what AIS and the lookups say, corrections that replace
 * them, a button to look the ship up again, and its photos
 */
export default function ShipEditor({ mmsi, onError }: ShipEditorProps) {
  const [view, setView] = useState<AdminShipView | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const show = (next: AdminShipView) => {
    setView(next)
    setDrafts(draftsFrom(next.overrides))
  }

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : "Something went wrong")
    onError(err)
  }

  useEffect(() => {
    let current = true
    getShip(mmsi)
      .then((ship) => current && show(ship))
      .catch((err) => current && fail(err))
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per ship (keyed by MMSI)
  }, [mmsi])

  // Saves corrections, keeping whatever isn't being changed
  const save = async (overrides: VesselOverrides, message: string) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await saveOverrides(mmsi, overrides)
      setView(saved)
      setStatus(message)
      return saved
    } catch (err) {
      fail(err)
      return null
    } finally {
      setBusy(false)
    }
  }

  const saveFields = async (e: FormEvent) => {
    e.preventDefault()
    if (!view) return
    const saved = await save({ ...view.overrides, fields: drafts }, "Details saved")
    if (saved) setDrafts(draftsFrom(saved.overrides))
  }

  const clearAll = async () => {
    if (!window.confirm("Remove every correction to this ship, including photos added by hand?")) return
    const saved = await save({}, "Corrections removed")
    if (saved) setDrafts({})
  }

  const refresh = async () => {
    if (!view) return
    const before = view.lookedUpAt
    setRefreshing(true)
    setError(null)
    setStatus("Looking the ship up again…")
    try {
      await refreshShip(mmsi)
      const started = Date.now()
      while (Date.now() - started < REFRESH_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_MS))
        const latest = await getShip(mmsi)
        if (latest.lookedUpAt !== before) {
          setView(latest)
          setStatus(latest.lookedUp ? "Lookup finished" : "Lookup finished: no sources know this ship")
          return
        }
      }
      setStatus("The lookup is taking a while (it may be queued, or a source is down); check back later")
    } catch (err) {
      setStatus(null)
      fail(err)
    } finally {
      setRefreshing(false)
    }
  }

  if (!view) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400 p-4">{error}</p> : <p className="text-sm text-slate-500 p-4">Loading…</p>
  }

  const { record, lookedUp } = view
  const inputClass =
    "w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
  const buttonClass =
    "px-3 py-1.5 rounded-md text-sm border border-slate-300 dark:border-slate-600 hover:border-blue-500 disabled:opacity-50"

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{view.info?.name ?? record.name ?? `MMSI ${mmsi}`}</h2>
          <p className="text-xs text-slate-500">
            MMSI {mmsi}
            {record.imo ? ` · IMO ${record.imo}` : ""}
            {record.callSign ? ` · ${record.callSign}` : ""}
            {record.length ? ` · ${record.length} × ${record.width ?? "?"} m` : ""}
            {record.destination ? ` · to ${record.destination}` : ""}
          </p>
          <p className="text-xs text-slate-500">
            {view.lookedUpAt ? `Looked up ${new Date(view.lookedUpAt).toLocaleString()}` : "Not looked up yet"}
            {lookedUp?.wikidataUrl && (
              <>
                {" · "}
                <a href={lookedUp.wikidataUrl} target="_blank" rel="noopener noreferrer">
                  Wikidata {lookedUp.wikidataId}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} disabled={refreshing || busy} onClick={refresh}>
            {refreshing ? "Refreshing…" : "Refresh ship data"}
          </button>
          <button type="button" className={buttonClass} disabled={busy} onClick={clearAll}>
            Clear corrections
          </button>
        </div>
      </section>

      {(status || error) && (
        <p role="status" className={`text-sm ${error ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}>
          {error ?? status}
        </p>
      )}

      <section>
        <h3 className="font-semibold mb-2">Details</h3>
        <p className="text-xs text-slate-500 mb-3">
          A correction replaces the looked-up value everywhere (map, app, alerts) and stays through later lookups.
          Leave it empty to use the looked-up value.
        </p>
        <form onSubmit={saveFields} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_1fr] gap-x-3 gap-y-2 items-center text-sm">
            <span className="hidden sm:block text-xs font-medium text-slate-500">Field</span>
            <span className="hidden sm:block text-xs font-medium text-slate-500">Looked up</span>
            <span className="hidden sm:block text-xs font-medium text-slate-500">Correction</span>
            {OVERRIDE_FIELDS.map((field) => (
              <div key={field.key} className="contents">
                <label htmlFor={`field-${field.key}`} className="font-medium sm:font-normal mt-2 sm:mt-0">
                  {field.label}
                </label>
                <span className="text-slate-600 dark:text-slate-400 break-words">{shown(lookedUp?.[field.key])}</span>
                <input
                  id={`field-${field.key}`}
                  type={field.type}
                  className={inputClass}
                  value={drafts[field.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Save details
            </button>
          </div>
        </form>
      </section>

      <PhotoManager
        view={view}
        busy={busy}
        onSave={(overrides, message) => save(overrides, message)}
        onUploaded={(next) => {
          setView(next)
          setStatus("Photo added")
        }}
        onError={fail}
      />
    </div>
  )
}
