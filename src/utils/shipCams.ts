// Ship cam video IDs from the WebSocket server (server/ship-cams.js), which
// finds each cam's live video on YouTube and sends them on subscribe and
// whenever a stream restarts with a new ID

import type { ShipCam } from "../constants/shipCams";

/** Each cam's current video ID, by cam id */
export type ShipCamVideoIds = Record<string, string>;

export interface ShipCamsMessage {
  type: "shipCams";
  videoIds: ShipCamVideoIds;
}

/** The video IDs in a ship cams message, or null for anything that isn't one */
export function parseShipCamsMessage(data: unknown): ShipCamVideoIds | null {
  const message = data as ShipCamsMessage | null;
  if (message?.type !== "shipCams" || typeof message.videoIds !== "object" || !message.videoIds) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(message.videoIds).filter(([, id]) => typeof id === "string" && /^[\w-]{11}$/.test(id)),
  );
}

/** The cam with the server's current video for it, if it has one */
export function withLiveVideo(cam: ShipCam, videoIds?: ShipCamVideoIds): ShipCam {
  const videoId = videoIds?.[cam.id];
  return videoId && videoId !== cam.videoId ? { ...cam, videoId } : cam;
}
