import { useEffect, useRef, useState } from "react"
import { Button } from "@headlessui/react"
import {
  ArrowUpIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid"
import { SHIP_CAMS, shipCamEmbedUrl } from "../constants/shipCams"
import { useLiveStream } from "../hooks/useLiveStream"
import { useVesselInfo } from "../hooks/useVesselInfo"
import { withLiveVideo, type ShipCamVideoIds } from "../utils/shipCams"
import { formatDistance, formatSpeed } from "../utils/geo"
import { describeCargo, guessCargo } from "../utils/cargo"
import { passageDirection } from "../utils/tvMode"
import type { TvShips } from "../hooks/useTvShips"
import type { TrackedShip } from "../types/ais"
import PhotoCarousel from "./PhotoCarousel"
import { vesselPhotos } from "../utils/vesselInfo"

// How long each of the ship's photos shows before the next
const TV_PHOTO_INTERVAL_MS = 8000

const M_TO_FT = 3.28084

interface TvModeProps extends TvShips {
  /** Mouse still: hide the exit button */
  idle: boolean
  /** Which cam to show (an id from SHIP_CAMS); the first cam if unknown */
  camId?: string | null
  /** Each cam's current live video from the server, if it looks them up */
  videoIds?: ShipCamVideoIds
  onExit: () => void
}

/**
 * TV mode's layer over the full-screen map: switches to the ship cam, full
 * screen, while a ship goes by the bridge, with the ship's details in the
 * corner. The map shows through the rest of the time, following any ship on
 * its way (with its details too).
 */
export default function TvMode({
  passing,
  approaching,
  idle,
  camId,
  videoIds,
  onExit,
}: TvModeProps) {
  const cam = withLiveVideo(SHIP_CAMS.find((c) => c.id === camId) ?? SHIP_CAMS[0], videoIds)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const src = shipCamEmbedUrl(cam)
  // Hidden behind the map for long stretches, so it can fall behind live
  useLiveStream(frameRef, src)

  return (
    <div className="absolute inset-0 z-40 pointer-events-none">
      {/* Kept loaded behind the map so the switch is instant. Clicks and
          mouse moves go through it, so the map stays usable and moving the
          mouse still wakes the controls */}
      <iframe
        ref={frameRef}
        className={`absolute inset-0 w-full h-full bg-black transition-opacity duration-1000 ${passing ? "opacity-100" : "opacity-0"}`}
        src={src}
        title={`${cam.name} live cam`}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
      />
      {passing ? (
        <ShipCard key={passing.mmsi} ship={passing} onCam />
      ) : (
        approaching && (
          <ShipCard
            key={approaching.ship.mmsi}
            ship={approaching.ship}
            etaMinutes={approaching.etaMinutes}
          />
        )
      )}
      <Button
        className={`pointer-events-auto absolute top-4 left-4 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900/70 text-slate-100 text-sm backdrop-blur-sm hover:bg-slate-900/90 cursor-pointer transition-opacity duration-300 ${idle ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        onClick={onExit}
        tabIndex={idle ? -1 : undefined}
        title="Exit TV mode (Esc)"
      >
        <XMarkIcon className="w-4 h-4" />
        Exit TV mode
      </Button>
    </div>
  )
}

interface ShipCardProps {
  ship: TrackedShip
  /** Shown over the cam rather than the map */
  onCam?: boolean
  /** Minutes from its last report until it reaches the bridge, for a countdown */
  etaMinutes?: number
}

function ShipCard({ ship, onCam = false, etaMinutes }: ShipCardProps) {
  // Look the ship up from the browser only when the server has nothing stored
  const lookup = useVesselInfo(
    ship.mmsi,
    ship.imo,
    ship.vesselInfo === undefined,
  )
  const info = ship.vesselInfo === undefined ? lookup.info : ship.vesselInfo
  const direction = passageDirection(ship)
  // The ship's course on screen: turned by the map's bearing, which the map
  // sets on a parent as --map-bearing
  const course =
    ship.cog >= 0 && ship.cog < 360
      ? ship.cog
      : direction === "upbound"
        ? 0
        : 180
  const cargo = guessCargo(ship.destination)

  const facts = [
    ship.length
      ? `${ship.length} m (${Math.round(ship.length * M_TO_FT)} ft)`
      : null,
    formatSpeed(ship.sog),
    `${formatDistance(ship.distanceToBridge)} from the bridge`,
  ].filter(Boolean)
  const about = [
    info?.yearBuilt ? `Built ${info.yearBuilt}` : null,
    info?.operator ? `Operated by ${info.operator}` : null,
  ].filter(Boolean)

  return (
    <section
      aria-label={onCam ? "Ship going by" : "Ship coming up"}
      aria-live="polite"
      className="absolute bottom-6 left-6 max-w-[min(46rem,calc(100%-3rem))] flex flex-col gap-4 p-5 rounded-2xl bg-slate-950/75 text-white backdrop-blur-md shadow-2xl"
    >
      <div className="flex gap-5">
        <div className="min-w-0 flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-sky-300">
            <ArrowUpIcon
              className="w-4 h-4"
              style={{
                transform: `rotate(calc(${course}deg - var(--map-bearing, 0deg)))`,
              }}
            />
            {direction === "upbound"
              ? "Upbound to Lake Huron"
              : "Downbound to Lake St. Clair"}
          </p>
          <h2 className="text-4xl font-bold leading-tight truncate">
            {ship.name}
          </h2>
          <p className="text-xl text-slate-200">{facts.join(" · ")}</p>
          {ship.destination && (
            <p className="text-xl text-slate-200 truncate">
              Bound for {ship.destination}
            </p>
          )}
          {cargo && (
            <p className="text-lg text-slate-300">{describeCargo(cargo)}</p>
          )}
          {about.length > 0 && (
            <p className="text-lg text-slate-300">{about.join(" · ")}</p>
          )}
        </div>
        {etaMinutes !== undefined && (
          // Restarted by each report, which brings a new ETA
          <Countdown
            key={ship.lastUpdate}
            reportedAt={ship.lastUpdate}
            etaMinutes={etaMinutes}
          />
        )}
      </div>
      {/* The cam shows the real thing */}
      {!onCam && (
        <div className="max-md:hidden">
          <PhotoCarousel
            key={ship.mmsi}
            photos={vesselPhotos(info)}
            alt=""
            imageClassName="w-full h-56 object-cover rounded-lg bg-slate-800"
            autoAdvanceMs={TV_PHOTO_INTERVAL_MS}
            hidden
          />
        </div>
      )}
    </section>
  )
}

/** Ticking minutes and seconds until the ship goes under the bridge */
function Countdown({
  reportedAt,
  etaMinutes,
}: {
  reportedAt: string
  etaMinutes: number
}) {
  const [arrival] = useState(
    () => (Date.parse(reportedAt) || Date.now()) + etaMinutes * 60_000,
  )
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const seconds = Math.max(0, Math.round((arrival - now) / 1000))
  const minutes = Math.floor(seconds / 60)
  return (
    <div className="shrink-0 self-start ml-auto flex flex-col items-center pl-5 border-l border-white/15">
      <span className="text-xs font-semibold uppercase tracking-widest text-amber-300">
        Under the bridge
      </span>
      <span
        role="timer"
        className="text-5xl font-bold tabular-nums text-amber-300"
        aria-label={`Under the bridge in ${minutes} min ${seconds % 60} s`}
      >
        {seconds > 0
          ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
          : "Now"}
      </span>
    </div>
  )
}
