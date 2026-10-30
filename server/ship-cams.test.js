import { describe, it, expect, vi, afterEach } from "vitest";
import { createShipCamFinder, liveVideoId, matchingVideoId } from "./ship-cams.js";

const CAM = { id: "cam", channelId: "UCchannel", title: /port huron/i, videoId: "old" };

const video = (id, liveBroadcastContent) => ({ items: [{ id, snippet: { liveBroadcastContent } }] });
const searchResult = (id, title, liveBroadcastContent = "live") => ({
  id: { videoId: id },
  snippet: { title, liveBroadcastContent },
});

describe("liveVideoId", () => {
  it("is the video's ID only while it's live", () => {
    expect(liveVideoId(video("old", "live"))).toBe("old");
    expect(liveVideoId(video("old", "none"))).toBeNull();
    expect(liveVideoId({ items: [] })).toBeNull();
  });
});

describe("matchingVideoId", () => {
  it("picks the live stream whose title matches", () => {
    const body = {
      items: [
        searchResult("mc", "Marine City, Michigan, USA | StreamTime LIVE"),
        searchResult("ph-old", "Port Huron, Michigan USA | StreamTime LIVE", "none"),
        searchResult("ph", "Port Huron, Michigan USA | StreamTime LIVE"),
      ],
    };
    expect(matchingVideoId(body, CAM.title)).toBe("ph");
  });

  it("is null without a match", () => {
    expect(matchingVideoId({ items: [searchResult("mc", "Marine City")] }, CAM.title)).toBeNull();
    expect(matchingVideoId({}, CAM.title)).toBeNull();
  });
});

describe("createShipCamFinder", () => {
  let finder;
  afterEach(() => {
    finder?.stop();
    vi.useRealTimers();
  });

  const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
  const api = (handlers) =>
    vi.fn(async (url) => {
      const { pathname } = new URL(url);
      return handlers[pathname.split("/").pop()]();
    });

  it("only checks the current video while it stays live", async () => {
    vi.useFakeTimers();
    const fetch = api({ videos: () => response(video("old", "live")) });
    finder = createShipCamFinder({ apiKey: "k", cams: [CAM], fetch, checkIntervalMs: 1000 });
    const onVideoIds = vi.fn();
    finder.on("videoIds", onVideoIds);

    finder.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain("/videos?part=snippet&id=old&key=k");
    expect(onVideoIds).not.toHaveBeenCalled();
    expect(finder.videoIds()).toEqual({ cam: "old" });
  });

  it("searches the channel when the video ends, and follows the new one", async () => {
    vi.useFakeTimers();
    const fetch = api({
      videos: () => response(video("old", "none")),
      search: () => response({ items: [searchResult("new", "Port Huron | StreamTime LIVE")] }),
    });
    finder = createShipCamFinder({ apiKey: "k", cams: [CAM], fetch });
    const onVideoIds = vi.fn();
    finder.on("videoIds", onVideoIds);

    finder.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls[1][0]).toContain("channelId=UCchannel&eventType=live");
    expect(onVideoIds).toHaveBeenCalledWith({ cam: "new" });
    expect(finder.videoIds()).toEqual({ cam: "new" });
  });

  it("waits between searches when nothing matches, to save quota", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const search = vi.fn(() => response({ items: [] }));
    const fetch = api({ videos: () => response(video("old", "none")), search });
    finder = createShipCamFinder({
      apiKey: "k",
      cams: [CAM],
      fetch,
      checkIntervalMs: 1000,
      searchIntervalMs: 5000,
      now: () => clock,
    });

    finder.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(search).toHaveBeenCalledTimes(1);
    clock = 3000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).toHaveBeenCalledTimes(1);
    clock = 5000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).toHaveBeenCalledTimes(2);
    expect(finder.videoIds()).toEqual({ cam: "old" });
  });

  it("keeps the current video when the API fails", async () => {
    vi.useFakeTimers();
    const logger = { warn: vi.fn(), log: vi.fn() };
    const fetch = api({ videos: () => response({}, false, 403) });
    finder = createShipCamFinder({ apiKey: "k", cams: [CAM], fetch, logger });

    finder.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
    expect(finder.videoIds()).toEqual({ cam: "old" });
  });
});
