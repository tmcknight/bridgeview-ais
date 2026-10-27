import { describe, it, expect, vi, afterEach } from "vitest";
import { createFeedStatus, QUIET_AFTER_MS } from "./feed-status.js";

describe("createFeedStatus", () => {
  let clock = 0;
  let feedStatus;
  const create = (sources) => {
    feedStatus = createFeedStatus({ sources, now: () => clock, checkIntervalMs: 1000 });
    return feedStatus;
  };

  afterEach(() => {
    feedStatus?.stop();
    vi.useRealTimers();
    clock = 0;
  });

  it("starts every configured feed as connecting", () => {
    expect(create(["aisstream", "local"]).snapshot()).toEqual([
      { source: "aisstream", status: "connecting" },
      { source: "local", status: "connecting" },
    ]);
  });

  it("is live once connected and down with the reason when the link drops", () => {
    create(["local"]);
    const onChange = vi.fn();
    feedStatus.on("change", onChange);

    feedStatus.setLink("local", "up");
    expect(feedStatus.snapshot()).toEqual([{ source: "local", status: "live" }]);

    feedStatus.setLink("local", "down", "AIS-catcher unavailable (ECONNREFUSED)");
    expect(onChange).toHaveBeenLastCalledWith([
      { source: "local", status: "down", detail: "AIS-catcher unavailable (ECONNREFUSED)" },
    ]);
  });

  it("turns quiet when a connected feed goes silent, and live again on a message", () => {
    vi.useFakeTimers();
    create(["aisstream"]);
    const onChange = vi.fn();
    feedStatus.on("change", onChange);
    feedStatus.setLink("aisstream", "up");
    feedStatus.messageReceived("aisstream");

    clock = QUIET_AFTER_MS.aisstream + 1;
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenLastCalledWith([
      { source: "aisstream", status: "quiet", lastMessageAt: new Date(0).toISOString() },
    ]);

    feedStatus.messageReceived("aisstream");
    expect(feedStatus.snapshot()[0].status).toBe("live");
  });

  it("only announces changes, not every message", () => {
    create(["aisstream"]);
    const onChange = vi.fn();
    feedStatus.on("change", onChange);
    feedStatus.setLink("aisstream", "up");
    feedStatus.messageReceived("aisstream");
    feedStatus.messageReceived("aisstream");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores feeds it wasn't configured with", () => {
    create(["aisstream"]);
    feedStatus.setLink("local", "up");
    feedStatus.messageReceived("local");
    expect(feedStatus.snapshot()).toHaveLength(1);
  });
});
