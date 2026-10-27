// Live YouTube cameras on the St. Clair River at Port Huron. These are run
// by others, and a stream gets a new video ID whenever its owner restarts it,
// so an ID here may need updating when a cam shows "unavailable"
export interface ShipCam {
  id: string
  name: string
  operator: string
  videoId: string
}

export const SHIP_CAMS: ShipCam[] = [
  {
    id: "streamtime",
    name: "Port Huron (StreamTime)",
    operator: "StreamTime Live",
    videoId: "AwP_Q6IGwFs",
  },
  {
    id: "boatnerd",
    name: "Port Huron (BoatNerd)",
    operator: "BoatNerd",
    videoId: "e9iSSQRHZ4Q",
  },
]

export function shipCamEmbedUrl(cam: ShipCam): string {
  return `https://www.youtube-nocookie.com/embed/${cam.videoId}?autoplay=1&mute=1&playsinline=1`
}

export function shipCamWatchUrl(cam: ShipCam): string {
  return `https://www.youtube.com/watch?v=${cam.videoId}`
}
