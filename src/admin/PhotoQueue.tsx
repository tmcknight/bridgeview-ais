import { useEffect, useState } from "react"
import {
  approveSubmission,
  banSubmitter,
  dismissReports,
  getBans,
  getReportedPhotos,
  getSubmissions,
  hideReportedPhoto,
  liftBan,
  rejectSubmission,
  REPORT_REASONS,
} from "./api"
import type { PhotoBan, PhotoSubmission, ReportedPhoto } from "./api"

interface PhotoQueueProps {
  onCount: (count: number) => void
  onOpenShip: (mmsi: number) => void
  onError: (err: unknown) => void
}

const smallButton =
  "px-2 py-1 rounded text-xs border border-slate-300 dark:border-slate-600 hover:border-blue-500 disabled:opacity-50"

/**
 * Photos reported from the iOS app (hide one, or dismiss its reports), then
 * photos shared from it waiting for approval: approve adds one to its ship
 * (shown first), reject deletes it, and ban also stops its sender sharing
 * again. Banned senders are listed below, to lift a ban.
 */
export default function PhotoQueue({ onCount, onOpenShip, onError }: PhotoQueueProps) {
  const [submissions, setSubmissions] = useState<PhotoSubmission[] | null>(null)
  const [bans, setBans] = useState<PhotoBan[]>([])
  const [reported, setReported] = useState<ReportedPhoto[]>([])
  const [busy, setBusy] = useState<number | string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Bumped to load the lists again
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)

  useEffect(() => {
    let current = true
    Promise.all([getSubmissions(), getBans(), getReportedPhotos()])
      .then(([found, banned, reports]) => {
        if (!current) return
        setSubmissions(found)
        setBans(banned)
        setReported(reports)
        onCount(found.length + reports.length)
      })
      .catch((err) => {
        if (!current) return
        setMessage(err instanceof Error ? err.message : "Couldn't load shared photos")
        onError(err)
      })
    return () => {
      current = false
    }
  }, [version, onCount, onError])

  const act = async (id: number | string, action: () => Promise<unknown>, done: string) => {
    setBusy(id)
    try {
      await action()
      setMessage(done)
      reload()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't work")
      onError(err)
    } finally {
      setBusy(null)
    }
  }

  const ban = (submission: PhotoSubmission) => {
    const reason = window.prompt("Ban whoever sent this photo? Everything they've sent is deleted. Reason (optional):")
    if (reason === null) return
    act(submission.id, () => banSubmitter(submission.id, reason), "Sender banned")
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Photo queue</h2>
        <button type="button" className={smallButton} onClick={reload}>
          Refresh
        </button>
        {message && <p className="text-sm text-slate-500">{message}</p>}
      </div>
      {reported.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-sm text-red-700 dark:text-red-400">Reported photos</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {reported.map((p) => (
              <li key={p.url} className="flex flex-col gap-2 p-2 rounded-md border border-red-300 dark:border-red-800">
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  <img src={p.url} alt="" loading="lazy" className="w-full aspect-video object-cover rounded bg-slate-200 dark:bg-slate-800" />
                </a>
                <div className="text-sm">
                  <button type="button" className="font-medium hover:underline" onClick={() => onOpenShip(p.mmsi)}>
                    {p.shipName ?? `MMSI ${p.mmsi}`}
                  </button>
                  <ul className="mt-1 flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
                    {p.reports.map((r, i) => (
                      <li key={i} className="break-words">
                        <span className="font-medium">{REPORT_REASONS[r.reason] ?? r.reason}</span>
                        {r.details ? `: “${r.details}”` : ""} · {new Date(r.createdAt).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className={`${smallButton} text-red-600 dark:text-red-400`}
                    disabled={busy !== null}
                    onClick={() => act(p.url, () => hideReportedPhoto(p.url), "Photo hidden")}
                  >
                    Hide photo
                  </button>
                  <button type="button" className={smallButton} disabled={busy !== null} onClick={() => act(p.url, () => dismissReports(p.url), "Reports dismissed")}>
                    Keep photo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h3 className="font-semibold text-sm">Shared photos waiting for approval</h3>
      {submissions === null && <p className="text-sm text-slate-500">Loading…</p>}
      {submissions?.length === 0 && <p className="text-sm text-slate-500">No photos waiting.</p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {submissions?.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 p-2 rounded-md border border-slate-200 dark:border-slate-700">
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              <img src={s.url} alt="" loading="lazy" className="w-full aspect-video object-cover rounded bg-slate-200 dark:bg-slate-800" />
            </a>
            <div className="text-sm">
              <button type="button" className="font-medium hover:underline" onClick={() => onOpenShip(s.mmsi)}>
                {s.shipName ?? `MMSI ${s.mmsi}`}
              </button>
              <span className="block text-xs text-slate-500">
                {new Date(s.createdAt).toLocaleString()}
                {s.width && s.height ? ` · ${s.width}×${s.height}` : ""} · {s.artist ? `credit: ${s.artist}` : "no credit"}
              </span>
              {s.note && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 break-words">“{s.note}”</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className={`${smallButton} border-green-600 text-green-700 dark:text-green-400`}
                disabled={busy !== null}
                onClick={() => act(s.id, () => approveSubmission(s.id), "Photo added to the ship")}
              >
                Approve
              </button>
              <button type="button" className={smallButton} disabled={busy !== null} onClick={() => act(s.id, () => rejectSubmission(s.id), "Photo rejected")}>
                Reject
              </button>
              <button type="button" className={`${smallButton} text-red-600 dark:text-red-400`} disabled={busy !== null} onClick={() => ban(s)}>
                Reject and ban sender
              </button>
            </div>
          </li>
        ))}
      </ul>

      {bans.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-sm">Banned senders</h3>
          <p className="text-xs text-slate-500">A ban blocks the sender's app for good, and their IP address for 30 days.</p>
          <ul className="flex flex-col divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-md">
            {bans.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {new Date(b.createdAt).toLocaleDateString()}
                  {b.reason ? ` · ${b.reason}` : ""}
                  {b.device ? "" : " · IP address only"}
                </span>
                <button
                  type="button"
                  className={smallButton}
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm("Lift this ban?")) act(b.id, () => liftBan(b.id), "Ban lifted")
                  }}
                >
                  Lift ban
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
