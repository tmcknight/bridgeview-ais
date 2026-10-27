// Wikidata details the server looked up and stored for a ship
// (server/vessel-details.js), sent with the ship's first position and when a
// lookup finishes

import type { VesselInfo } from "../types/vessel";

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
