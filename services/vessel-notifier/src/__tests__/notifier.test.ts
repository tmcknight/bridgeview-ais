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
    fetchMock.mockClear();

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
  });
});
