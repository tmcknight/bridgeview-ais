import { useCallback, useEffect, useState } from "react"
import {
  FAVOURITES_KEY,
  loadFavourites,
  parseFavourites,
  saveFavourites,
  toggleFavourite as toggle,
  type Favourites,
} from "../utils/favourites"

export interface UseFavouritesResult {
  favourites: Favourites
  isFavourite: (mmsi: number) => boolean
  toggleFavourite: (mmsi: number, name: string) => void
}

/**
 * Favourite ships, saved in this browser and kept in step across its tabs
 */
export function useFavourites(): UseFavouritesResult {
  const [favourites, setFavourites] = useState<Favourites>(loadFavourites)

  // Another tab changed them
  useEffect(() => {
    const handleStorage = (e: StorageEvent): void => {
      if (e.key === FAVOURITES_KEY) setFavourites(parseFavourites(e.newValue))
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const toggleFavourite = useCallback((mmsi: number, name: string) => {
    setFavourites((prev) => {
      const next = toggle(prev, mmsi, name)
      saveFavourites(next)
      return next
    })
  }, [])

  const isFavourite = useCallback((mmsi: number) => favourites.has(mmsi), [favourites])

  return { favourites, isFavourite, toggleFavourite }
}
