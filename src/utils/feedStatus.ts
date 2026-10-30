// Health of each AIS and ADS-B feed, reported by the WebSocket server (server/feed-status.js),
// which sends a snapshot on subscribe and again whenever a feed's status changes

import type { AISSource } from "../types/ais";

/**
 * connecting: opening the link; live: messages arriving;
 * quiet: link up but nothing received for a while; down: link lost, retrying
 */
export type FeedHealth = "connecting" | "live" | "quiet" | "down";

/** An AIS feed, or "adsb" for the aircraft feed */
export type FeedSource = AISSource | "adsb";

export interface FeedStatus {
  source: FeedSource;
  status: FeedHealth;
  /** Why the feed is down, e.g. a refused connection or a rejected API key */
  detail?: string;
  lastMessageAt?: string;
  /** The feed's own web page, e.g. the antenna's AIS-catcher view */
  url?: string;
}

export interface FeedStatusMessage {
  type: "feedStatus";
  feeds: FeedStatus[];
}

/** The feeds in a feed status message, or null for anything that isn't one */
export function parseFeedStatusMessage(data: unknown): FeedStatus[] | null {
  const message = data as FeedStatusMessage | null;
  return message?.type === "feedStatus" && Array.isArray(message.feeds) ? message.feeds : null;
}

/** Whether the server reports using this feed, whatever its health */
export function hasFeed(feeds: FeedStatus[] | null | undefined, source: FeedSource): boolean {
  return feeds?.some((feed) => feed.source === source) ?? false;
}

/** Whether the aircraft feed is adsb.fi's (the server links it to adsb.fi's map), which must be credited */
export function isAdsbFiFeed(feeds: FeedStatus[] | null | undefined): boolean {
  const url = feeds?.find((feed) => feed.source === "adsb")?.url;
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === "adsb.fi" || hostname.endsWith(".adsb.fi");
  } catch {
    return false;
  }
}
