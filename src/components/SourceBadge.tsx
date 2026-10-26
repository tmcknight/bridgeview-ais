import type { AISSource } from "../types/ais"
import { SignalIcon, CloudIcon } from "@heroicons/react/20/solid"

interface SourceBadgeProps {
  source: AISSource
  signalPower?: number
}

// Shows whether a ship's last position came from the local antenna or AISStream.io
export default function SourceBadge({ source, signalPower }: SourceBadgeProps) {
  if (source === "local") {
    const level = signalPower !== undefined ? `${signalPower.toFixed(1)} dB` : null
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-emerald-600 dark:text-emerald-400"
        title={`Last position heard by the local antenna${level ? `, signal ${level}` : ""}`}
      >
        <SignalIcon className="shrink-0 w-3 h-3" />
        Antenna{level && ` · ${level}`}
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      title="Last position from AISStream.io"
    >
      <CloudIcon className="shrink-0 w-3 h-3" />
      AISStream
    </span>
  )
}
