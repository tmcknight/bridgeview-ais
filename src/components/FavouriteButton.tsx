import { StarIcon as StarSolid } from "@heroicons/react/20/solid"
import { StarIcon as StarOutline } from "@heroicons/react/24/outline"
import { spell } from "../utils/locale"

interface FavouriteButtonProps {
  name: string
  isFavourite: boolean
  onToggle: () => void
  /** Out of the tab order while the panel is hidden */
  hidden?: boolean
}

/** Star that adds a ship to favourites or takes it off, inside a clickable row */
export default function FavouriteButton({
  name,
  isFavourite,
  onToggle,
  hidden = false,
}: FavouriteButtonProps) {
  const label = spell(isFavourite ? `Remove ${name} from favourites` : `Add ${name} to favourites`)
  const Icon = isFavourite ? StarSolid : StarOutline
  return (
    <button
      type="button"
      className="shrink-0 p-0.5 -m-0.5 rounded hover:bg-slate-300/50 dark:hover:bg-slate-600/50 focus-visible:outline-2 focus-visible:outline-blue-500 transition-colors cursor-pointer"
      aria-label={label}
      aria-pressed={isFavourite}
      title={label}
      tabIndex={hidden ? -1 : 0}
      // The row behind it selects the ship
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Icon
        className={`w-4 h-4 ${isFavourite ? "text-amber-400" : "text-slate-400 dark:text-slate-500"}`}
      />
    </button>
  )
}
