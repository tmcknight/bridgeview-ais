import { EventEmitter } from "node:events";

// Health of each AIS feed the server is configured to use, sent to clients as
// {type: "feedStatus", feeds} on subscribe and whenever a feed's status changes.
//
// Statuses:
//   connecting - opening the link (or waiting to retry before ever connecting)
//   live       - link up and messages arriving
//   quiet      - link up but nothing received for a while
//   down       - link lost or failing; retrying

// How long a connected feed can go without a message before it counts as quiet.
// AISStream covers a wide area and is rarely silent; the antenna only hears
// nearby ships, so a quiet spell there is more normal. The ADS-B feed is polled
// every few seconds, so a minute without a good poll is worth showing.
export const QUIET_AFTER_MS = {
  aisstream: 2 * 60_000,
  local: 10 * 60_000,
  adsb: 60_000,
};

const CHECK_INTERVAL_MS = 15_000;

// links: optional web page per source (e.g. the antenna's AIS-catcher view), sent as each feed's url
export function createFeedStatus({ sources, links = {}, now = Date.now, checkIntervalMs = CHECK_INTERVAL_MS }) {
  const emitter = new EventEmitter();
  const feeds = new Map(
    sources.map((source) => [
      source,
      { source, link: "connecting", detail: undefined, lastMessageAt: null, connectedAt: null },
    ])
  );
  let published = "";

  function statusOf(feed) {
    if (feed.link !== "up") return feed.link;
    const since = feed.lastMessageAt ?? feed.connectedAt;
    return now() - since > (QUIET_AFTER_MS[feed.source] ?? QUIET_AFTER_MS.aisstream) ? "quiet" : "live";
  }

  function snapshot() {
    return Array.from(feeds.values(), (feed) => {
      const status = { source: feed.source, status: statusOf(feed) };
      if (links[feed.source]) status.url = links[feed.source];
      if (feed.detail) status.detail = feed.detail;
      if (feed.lastMessageAt !== null) status.lastMessageAt = new Date(feed.lastMessageAt).toISOString();
      return status;
    });
  }

  // Emit "change" only when a feed's status or detail changes, not on every message
  function publish() {
    const feedsNow = snapshot();
    const key = JSON.stringify(feedsNow.map(({ source, status, detail }) => [source, status, detail]));
    if (key === published) return;
    published = key;
    emitter.emit("change", feedsNow);
  }

  emitter.snapshot = snapshot;

  // link: "connecting" | "up" | "down"; detail explains a problem, e.g. a refused connection
  emitter.setLink = (source, link, detail) => {
    const feed = feeds.get(source);
    if (!feed) return;
    if (link === "up" && feed.link !== "up") feed.connectedAt = now();
    feed.link = link;
    feed.detail = detail;
    publish();
  };

  emitter.messageReceived = (source) => {
    const feed = feeds.get(source);
    if (!feed) return;
    feed.lastMessageAt = now();
    // A message proves the link works, clearing an earlier error
    if (feed.link === "up") feed.detail = undefined;
    publish();
  };

  // Quiet is about time passing, so check periodically
  const timer = setInterval(publish, checkIntervalMs);
  timer.unref?.();
  published = JSON.stringify(snapshot().map(({ source, status, detail }) => [source, status, detail]));

  emitter.stop = () => clearInterval(timer);

  return emitter;
}
