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
});
