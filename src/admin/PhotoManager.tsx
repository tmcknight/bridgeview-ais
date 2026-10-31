import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { uploadPhoto } from "./api"
import PhotoSearch from "./PhotoSearch"
import type { AdminShipView, VesselOverrides } from "./api"
import type { VesselPhoto } from "../types/vessel"

interface PhotoManagerProps {
  view: AdminShipView
  busy: boolean
  onSave: (overrides: VesselOverrides, message: string) => Promise<unknown>
  onUploaded: (view: AdminShipView) => void
  onError: (err: unknown) => void
}

interface CreditDraft {
  title: string
  artist: string
  license: string
  pageUrl: string
}

const EMPTY_CREDIT: CreditDraft = { title: "", artist: "", license: "", pageUrl: "" }

// The photos the lookups found, as clients would get them without corrections
function lookedUpPhotos(view: AdminShipView): VesselPhoto[] {
  const info = view.lookedUp
  if (info?.photos?.length) return info.photos
  return info?.imageUrl ? [{ url: info.imageUrl, pageUrl: info.imagePageUrl }] : []
}

function credit(photo: VesselPhoto): string {
  return [photo.title, photo.artist, photo.license].filter(Boolean).join(" · ")
}

/**
 * A ship's photos: the lookups' and those added here. Each can be hidden or
 * shown first; added ones can be removed. New photos can be uploaded or linked.
 */
export default function PhotoManager({ view, busy, onSave, onUploaded, onError }: PhotoManagerProps) {
  const { overrides } = view
  const added = overrides.addedPhotos ?? []
  const hidden = new Set(overrides.hiddenPhotos ?? [])
  const firstShown = view.info?.photos?.[0]?.url ?? view.info?.imageUrl
  const all = [
    ...added.map((photo) => ({ photo, added: true })),
    ...lookedUpPhotos(view)
      .filter((photo) => !added.some((a) => a.url === photo.url))
      .map((photo) => ({ photo, added: false })),
  ]

  const [linkUrl, setLinkUrl] = useState("")
  const [draft, setDraft] = useState<CreditDraft>(EMPTY_CREDIT)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const toggleHidden = (url: string) => {
    const next = hidden.has(url) ? [...hidden].filter((u) => u !== url) : [...hidden, url]
    onSave(
      { ...overrides, hiddenPhotos: next, ...(overrides.primaryPhoto === url && { primaryPhoto: undefined }) },
      hidden.has(url) ? "Photo shown" : "Photo hidden"
    )
  }

  const makeFirst = (url: string) =>
    onSave({ ...overrides, primaryPhoto: url, hiddenPhotos: [...hidden].filter((u) => u !== url) }, "Photo shown first")

  const remove = (url: string) => {
    if (!window.confirm("Remove this photo? An uploaded one is deleted.")) return
    onSave(
      {
        ...overrides,
        addedPhotos: added.filter((p) => p.url !== url),
        hiddenPhotos: [...hidden].filter((u) => u !== url),
        ...(overrides.primaryPhoto === url && { primaryPhoto: undefined }),
      },
      "Photo removed"
    )
  }

  const credits = { title: draft.title, artist: draft.artist, license: draft.license }

  const addLink = async (e: FormEvent) => {
    e.preventDefault()
    const photo: VesselPhoto = { url: linkUrl.trim(), ...credits, pageUrl: draft.pageUrl.trim() || undefined }
    const saved = await onSave({ ...overrides, addedPhotos: [photo, ...added] }, "Photo added")
    if (saved) {
      setLinkUrl("")
      setDraft(EMPTY_CREDIT)
    }
  }

  const upload = async () => {
    const file = fileInput.current?.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      onUploaded(await uploadPhoto(view.mmsi, file, credits))
      setDraft(EMPTY_CREDIT)
      if (fileInput.current) fileInput.current.value = ""
    } catch (err) {
      onError(err)
    } finally {
      setUploading(false)
    }
  }

  const inputClass =
    "w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
  const smallButton =
    "px-2 py-1 rounded text-xs border border-slate-300 dark:border-slate-600 hover:border-blue-500 disabled:opacity-50"

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">Photos</h3>
      {all.length === 0 && <p className="text-sm text-slate-500">No photos yet.</p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {all.map(({ photo, added: isAdded }) => {
          const isHidden = hidden.has(photo.url)
          return (
            <li
              key={photo.url}
              className={`flex flex-col gap-2 p-2 rounded-md border border-slate-200 dark:border-slate-700 ${isHidden ? "opacity-50" : ""}`}
            >
              <a href={photo.pageUrl ?? photo.url} target="_blank" rel="noopener noreferrer">
                <img src={photo.url} alt="" loading="lazy" className="w-full aspect-video object-cover rounded bg-slate-200 dark:bg-slate-800" />
              </a>
              <p className="text-xs text-slate-500 break-words">
                {isAdded ? "Added" : "Looked up"}
                {photo.url === firstShown && !isHidden ? " · shown first" : ""}
                {isHidden ? " · hidden" : ""}
                {credit(photo) ? ` · ${credit(photo)}` : ""}
              </p>
              <div className="flex flex-wrap gap-1">
                {photo.url !== firstShown && !isHidden && (
                  <button type="button" className={smallButton} disabled={busy} onClick={() => makeFirst(photo.url)}>
                    Show first
                  </button>
                )}
                {isAdded ? (
                  <button type="button" className={smallButton} disabled={busy} onClick={() => remove(photo.url)}>
                    Remove
                  </button>
                ) : (
                  <button type="button" className={smallButton} disabled={busy} onClick={() => toggleHidden(photo.url)}>
                    {isHidden ? "Show" : "Hide"}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <PhotoSearch
        key={view.mmsi}
        initialQuery={view.record.name ?? view.info?.name ?? ""}
        existing={new Set(all.map(({ photo }) => photo.url))}
        busy={busy}
        onAdd={(photo) => onSave({ ...overrides, addedPhotos: [photo, ...added] }, "Photo added")}
        onError={onError}
      />

      <form onSubmit={addLink} className="flex flex-col gap-2 p-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600">
        <h4 className="text-sm font-medium">Add a photo</h4>
        <p className="text-xs text-slate-500">Credit the photographer and licence where the photo's terms ask for it.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={inputClass} placeholder="Caption" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input className={inputClass} placeholder="Photographer" value={draft.artist} onChange={(e) => setDraft({ ...draft, artist: e.target.value })} />
          <input className={inputClass} placeholder="Licence (e.g. CC BY-SA 4.0)" value={draft.license} onChange={(e) => setDraft({ ...draft, license: e.target.value })} />
          <input className={inputClass} type="url" placeholder="Source page (optional)" value={draft.pageUrl} onChange={(e) => setDraft({ ...draft, pageUrl: e.target.value })} />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className={inputClass} type="url" placeholder="Image URL" aria-label="Image URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
          <button type="submit" className={smallButton} disabled={busy || !linkUrl.trim()}>
            Add link
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo file" className="text-sm" />
          <button type="button" className={smallButton} disabled={busy || uploading} onClick={upload}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </section>
  )
}
