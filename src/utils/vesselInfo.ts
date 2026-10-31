// Vessel details the server looked up and stored for a ship
// (server/vessel-details.js), sent with the ship's first position and when a
// lookup finishes

import type { VesselInfo, VesselPhoto } from "../types/vessel";

export interface VesselInfoMessage {
  type: "vesselInfo";
  mmsi: number;
  /** null when Wikidata has no matching vessel */
  info: VesselInfo | null;
}

/** The message if it's a vessel info message, or null for anything else */
export function parseVesselInfoMessage(data: unknown): VesselInfoMessage | null {
  const message = data as VesselInfoMessage | null;
  return message?.type === "vesselInfo" && typeof message.mmsi === "number" && message.info !== undefined
    ? message
    : null;
}

/** The ship's photos, best first: the server's list, else Wikidata's one photo */
export function vesselPhotos(info: VesselInfo | null | undefined): VesselPhoto[] {
  if (info?.photos?.length) return info.photos;
  return info?.imageUrl ? [{ url: info.imageUrl, pageUrl: info.imagePageUrl }] : [];
}
