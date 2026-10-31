import { fetchVesselInfo } from "./wikidata.js";
import { fileName } from "./commons.js";

// A ship's VesselInfo (src/types/vessel.ts) comes from four places:
// Wikidata (photo, builder, operator), USCG PSIX (`uscg`: service type, flag,
// deadweight, inspections) and Wikimedia Commons (`photos`), looked up per
// ship and stored together, and Transport Canada's register (`registry`),
// added when it's read. Wikidata's values win; the registers fill in build
// year and gross tonnage where it has none, with the flag state's own
// register (Transport Canada) ahead of the USCG's.

// fetchInfo for createVesselDetails: Wikidata, PSIX and Commons together, null
// when none has the ship. Rejects when any lookup fails, to be tried again.
export function createInfoFetcher({ wikidata = true, fetchUscg = null, fetchPhotos = null } = {}) {
  return async (mmsi, { imo, callSign, name } = {}) => {
    const [found, uscg] = await Promise.all([
      wikidata ? fetchVesselInfo(mmsi, imo) : null,
      fetchUscg ? fetchUscg({ imo, callSign }) : null,
    ]);
    // Wikidata's Commons category and photo help find and rank the rest
    const photos = fetchPhotos
      ? [...(await fetchPhotos({ imo, category: found?.commonsCategory, name: found?.name ?? name, preferredFile: found?.imagePageUrl }))]
      : [];
    // Wikidata's photo may be filed outside the ship's categories
    if (found?.imageUrl && !photos.some((p) => fileName(p.pageUrl) === fileName(found.imagePageUrl))) {
      photos.unshift({ url: found.imageUrl, pageUrl: found.imagePageUrl });
    }
    if (!found && !uscg && photos.length === 0) return null;
    const { commonsCategory: _category, ...info } = found ?? {};
    return { ...info, ...(uscg && { uscg }), ...(photos.length > 0 && { photos }) };
  };
}

// The stored details with the ship's register record added and the gaps
// filled in. undefined (not looked up yet) stays undefined, so the browser
// can look the ship up itself; null (no match) becomes details when the
// register has the ship.
export function completeVesselInfo(stored, registry) {
  if (stored === undefined) return undefined;
  if (!stored && !registry) return stored;
  const info = { ...stored, ...(registry && { registry }) };
  for (const source of [info.registry, info.uscg]) {
    if (!source) continue;
    if (info.yearBuilt === undefined && source.yearBuilt) info.yearBuilt = source.yearBuilt;
    if (info.grossTonnage === undefined && source.grossTonnage) info.grossTonnage = Math.round(source.grossTonnage);
  }
  // Clients that only know one photo show the best one
  if (!info.imageUrl && info.photos?.[0]) {
    info.imageUrl = info.photos[0].url;
    info.imagePageUrl = info.photos[0].pageUrl;
  }
  return info;
}
