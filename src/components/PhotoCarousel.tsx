import { useEffect, useState } from "react"
import type { MouseEvent } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid"
import type { VesselPhoto } from "../types/vessel"

interface PhotoCarouselProps {
  photos: VesselPhoto[]
  alt: string
  /** Classes for the image (size, rounding) */
  imageClassName: string
  /** Move to the next photo on its own this often; no buttons are shown then */
  autoAdvanceMs?: number
  /** Out of the tab order, e.g. while the card is collapsed */
  hidden?: boolean
}

// Shown on hover with a mouse; always shown on touch screens, which can't hover
const buttonClassName =
  "absolute top-1/2 -translate-y-1/2 p-1 rounded-full bg-slate-900/60 text-white hover:bg-slate-900/80 cursor-pointer transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"

function credit(photo: VesselPhoto): string | null {
  const parts = [photo.artist, photo.license].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

/**
 * A ship's photos, one at a time, with arrows (or a timer) to step through
 * them and each photo's credit beneath it. Key it by ship so a new ship
 * starts at its first photo.
 */
export default function PhotoCarousel({ photos, alt, imageClassName, autoAdvanceMs, hidden = false }: PhotoCarouselProps) {
  const [index, setIndex] = useState(0)
  const count = photos.length

  useEffect(() => {
    if (!autoAdvanceMs || count < 2) return
    const id = setInterval(() => setIndex((i) => (i + 1) % count), autoAdvanceMs)
    return () => clearInterval(id)
  }, [autoAdvanceMs, count])

  if (count === 0) return null
  const photo = photos[index % count]
  const photoCredit = credit(photo)

  // The carousel sits inside a selectable ship card
  const stopCardSelect = {
    tabIndex: hidden ? -1 : undefined,
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
  }
  const step = (by: number) => (e: MouseEvent) => {
    e.stopPropagation()
    setIndex((i) => (i + by + count) % count)
  }

  return (
    <figure className="flex flex-col gap-1">
      <div className="relative group">
        <a
          href={photo.pageUrl ?? photo.url}
          target="_blank"
          rel="noopener noreferrer"
          title="View image on Wikimedia Commons"
          onClick={(e) => e.stopPropagation()}
          {...stopCardSelect}
        >
          <img src={photo.url} alt={alt} loading="lazy" className={imageClassName} />
        </a>
        {count > 1 && !autoAdvanceMs && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              className={`${buttonClassName} left-1.5`}
              onClick={step(-1)}
              {...stopCardSelect}
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              className={`${buttonClassName} right-1.5`}
              onClick={step(1)}
              {...stopCardSelect}
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </>
        )}
        {count > 1 && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-slate-900/60 text-white text-[0.6rem] tabular-nums">
            {(index % count) + 1} / {count}
          </span>
        )}
      </div>
      {photoCredit && (
        <figcaption className="text-[0.6rem] text-slate-500 dark:text-slate-400 truncate">
          Photo: {photoCredit}
        </figcaption>
      )}
    </figure>
  )
}
