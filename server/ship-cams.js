import { EventEmitter } from "node:events";

// Finds each ship cam's current live video on YouTube, so the cam keeps
// working when its owner restarts the stream (which gives it a new video ID).
// Sent to clients as {type: "shipCams", videoIds: {<cam id>: <video id>}} on
// subscribe and whenever one changes.
//
// A cam's channel can run many streams at once (StreamTime runs ~15), so a
// cam is found by its channel and a word in its title. Uses the YouTube Data
// API (YOUTUBE_API_KEY), which allows 10,000 quota units a day: checking that
// the current video is still live costs 1, searching the channel costs 100,
// so the search only runs when the video has gone and at most every 20 min.

// The ids match src/constants/shipCams.ts; videoId is the one to start from
export const SHIP_CAMS = [
  {
    id: "streamtime",
    channelId: "UCrtIIVfi-5tMlVXdMDzOMUA",
    title: /port huron/i,
    videoId: "AwP_Q6IGwFs",
  },
];

const API_URL = "https://www.googleapis.com/youtube/v3";
const CHECK_INTERVAL_MS = 5 * 60_000;
const SEARCH_INTERVAL_MS = 20 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

// The video's ID if it's live now, else null
export function liveVideoId(body) {
  const video = body?.items?.[0];
  return video?.snippet?.liveBroadcastContent === "live" ? video.id : null;
}

// The first live video in a channel search whose title matches, else null
export function matchingVideoId(body, title) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const match = items.find(
    (item) =>
      typeof item?.id?.videoId === "string" &&
      item.snippet?.liveBroadcastContent === "live" &&
      title.test(item.snippet.title ?? ""),
  );
  return match ? match.id.videoId : null;
}

// Events: "videoIds" ({<cam id>: <video id>}) when one changes
export function createShipCamFinder({
  apiKey,
  cams = SHIP_CAMS,
  logger,
  fetch = globalThis.fetch,
  checkIntervalMs = CHECK_INTERVAL_MS,
  searchIntervalMs = SEARCH_INTERVAL_MS,
  now = Date.now,
}) {
  const emitter = new EventEmitter();
  const videoIds = Object.fromEntries(cams.map((cam) => [cam.id, cam.videoId]));
  const lastSearchAt = new Map();
  let timer = null;
  let stopped = false;

  async function get(path, params) {
    const url = `${API_URL}/${path}?${new URLSearchParams({ ...params, key: apiKey })}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function checkCam(cam) {
    const current = videoIds[cam.id];
    if (liveVideoId(await get("videos", { part: "snippet", id: current })) === current) return;

    const searchedAt = lastSearchAt.get(cam.id);
    if (searchedAt !== undefined && now() - searchedAt < searchIntervalMs) return;
    lastSearchAt.set(cam.id, now());
    const found = matchingVideoId(
      await get("search", {
        part: "snippet",
        channelId: cam.channelId,
        eventType: "live",
        type: "video",
        maxResults: "50",
      }),
      cam.title,
    );
    if (!found) {
      logger?.warn(`[ship-cams] ${cam.id}: ${current} isn't live, and no live stream matches`);
      return;
    }
    if (found === current) return;
    logger?.log(`[ship-cams] ${cam.id}: now ${found} (was ${current})`);
    videoIds[cam.id] = found;
    emitter.emit("videoIds", { ...videoIds });
  }

  async function check() {
    for (const cam of cams) {
      try {
        await checkCam(cam);
      } catch (err) {
        logger?.warn(`[ship-cams] ${cam.id}: check failed: ${err.message}`);
      }
    }
    if (!stopped) timer = setTimeout(check, checkIntervalMs);
  }

  emitter.videoIds = () => ({ ...videoIds });
  emitter.start = () => {
    stopped = false;
    check();
  };
  emitter.stop = () => {
    stopped = true;
    clearTimeout(timer);
  };

  return emitter;
}
