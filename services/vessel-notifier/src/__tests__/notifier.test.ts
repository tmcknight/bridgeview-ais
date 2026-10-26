import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VesselNotifier } from "../notifier.js";

// Mock WebSocket
vi.mock("ws", async () => {
  const { default: EventEmitter } =
    await vi.importActual<typeof import("events")>("events");

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;

    readyState = 1; // OPEN

    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = 3;
    });

    constructor() {
      super();
      // Emit open in next tick so event handlers can be attached
      setTimeout(() => this.emit("open"), 0);
    }
  }

  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

// Mock fetch for ntfy
const fetchMock = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  statusText: "OK",
});
vi.stubGlobal("fetch", fetchMock);

describe("VesselNotifier", () => {
  let notifier: VesselNotifier;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    notifier = new VesselNotifier({
      ntfyServer: "https://ntfy.example.com",
      ntfyTopic: "test-topic",
      wsProxyUrl: "ws://localhost:3001",
      bridgeThresholdNM: 0.5,
      notificationCooldownMs: 30 * 60 * 1000,
    });
  });

  afterEach(() => {
    notifier.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("start/stop", () => {
    it("starts the service", () => {
      notifier.start();
      expect(notifier.status.running).toBe(true);
    });

    it("stops the service", () => {
      notifier.start();
      notifier.stop();
      expect(notifier.status.running).toBe(false);
    });

    it("does not start twice", () => {
      notifier.start();
      notifier.start(); // Should be a no-op
      expect(notifier.status.running).toBe(true);
    });
  });

  describe("status", () => {
    it("reports initial status", () => {
      const status = notifier.status;
      expect(status.running).toBe(false);
      expect(status.connected).toBe(false);
      expect(status.trackedVessels).toBe(0);
      expect(status.cooldownVessels).toBe(0);
    });
  });

  describe("watch points and webhook", () => {
    interface MockSocket {
      send: ReturnType<typeof vi.fn>;
      emit(event: string, data?: unknown): void;
    }

    function position(lat: number, lon: number) {
      return JSON.stringify({
        MessageType: "PositionReport",
        MetaData: { MMSI: 123456789, MMSI_String: "123456789", ShipName: "TEST", latitude: lat, longitude: lon, time_utc: "" },
        Message: {
          PositionReport: { Cog: 180, Latitude: lat, Longitude: lon, NavigationalStatus: 0, Sog: 8, TrueHeading: 180, UserID: 123456789 },
        },
      });
    }

    it("subscribes per watch point and POSTs passages to the webhook", async () => {
      notifier.stop();
      notifier = new VesselNotifier({
        wsProxyUrl: "ws://localhost:3001",
        webhookUrl: "https://example.com/hook",
        vesselInfoLookup: false,
        watchPoints: [
          { id: "a", name: "Point A", latitude: 43.0, longitude: -82.42, radiusNM: 0.5 },
          { id: "b", name: "Point B", latitude: 42.5, longitude: -82.9, radiusNM: 1 },
        ],
      });
      notifier.start();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (notifier as unknown as { ws: MockSocket }).ws;
      const subscription = JSON.parse(ws.send.mock.calls[0][0]);
      expect(subscription.BoundingBoxes).toHaveLength(2);

      ws.emit("message", position(43.05, -82.42));
      ws.emit("message", position(43.0, -82.42));
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://example.com/hook");
      expect(JSON.parse(options.body).watchPoint.id).toBe("a");
    });

    it("keeps the default prediction horizon when none is configured", async () => {
      notifier.stop();
      notifier = new VesselNotifier({
        wsProxyUrl: "ws://localhost:3001",
        webhookUrl: "https://example.com/hook",
        vesselInfoLookup: false,
        watchPoints: [{ id: "a", name: "Point A", latitude: 43.0, longitude: -82.42, radiusNM: 0.5 }],
      });
      notifier.start();
      await vi.advanceTimersByTimeAsync(0);

      // 3 NM out at 8 kn is ~22 minutes away: beyond the 10 minute horizon
      const ws = (notifier as unknown as { ws: MockSocket }).ws;
      ws.emit("message", position(43.05, -82.42));
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a predicted passage when the vessel is due abeam", async () => {
      notifier.stop();
      notifier = new VesselNotifier({
        wsProxyUrl: "ws://localhost:3001",
        webhookUrl: "https://example.com/hook",
        vesselInfoLookup: false,
        watchPoints: [{ id: "a", name: "Point A", latitude: 43.0, longitude: -82.42, radiusNM: 0.5 }],
      });
      notifier.start();
      await vi.advanceTimersByTimeAsync(0);

      // 0.1 NM north, heading south at 8 kn: abeam in 45 s, alert 20 s early
      const ws = (notifier as unknown as { ws: MockSocket }).ws;
      ws.emit("message", position(43.0 + 0.1 / 60, -82.42));
      await vi.advanceTimersByTimeAsync(24_000);
      expect(fetchMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).timing).toBe("predicted");
    });

    it("adds Wikidata details looked up while the vessel approached", async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.startsWith("https://query.wikidata.org/")
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                results: {
                  bindings: [
                    {
                      ship: { type: "uri", value: "http://www.wikidata.org/entity/Q6719625" },
                      built: { type: "literal", value: "1979-01-01T00:00:00Z" },
                    },
                  ],
                },
              }),
            }
          : { ok: true, status: 200, statusText: "OK" }
      );

      notifier.stop();
      notifier = new VesselNotifier({
        wsProxyUrl: "ws://localhost:3001",
        webhookUrl: "https://example.com/hook",
        watchPoints: [{ id: "a", name: "Point A", latitude: 43.0, longitude: -82.42, radiusNM: 0.5 }],
      });
      notifier.start();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (notifier as unknown as { ws: MockSocket }).ws;
      ws.emit("message", position(43.05, -82.42));
      ws.emit("message", position(43.0, -82.42));
      await vi.advanceTimersByTimeAsync(0);

      const webhookCalls = fetchMock.mock.calls.filter(([url]) => url === "https://example.com/hook");
      expect(webhookCalls).toHaveLength(1);
      const body = JSON.parse(webhookCalls[0][1].body);
      expect(body.vessel.wikidata).toMatchObject({ wikidataId: "Q6719625", yearBuilt: 1979 });

      // Looked up once on first sighting, reused at the passage
      const lookups = fetchMock.mock.calls.filter(([url]) => url.startsWith("https://query.wikidata.org/"));
      expect(lookups).toHaveLength(1);
    });
  });
});
