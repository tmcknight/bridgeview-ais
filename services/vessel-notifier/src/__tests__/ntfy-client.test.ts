import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NtfyClient } from "../ntfy-client.js";
import type { BridgeCrossingEvent } from "../types.js";

function makeCrossingEvent(
  overrides: Partial<BridgeCrossingEvent> = {}
): BridgeCrossingEvent {
  return {
    mmsi: 123456789,
    name: "TEST VESSEL",
    speed: 8.5,
    course: 180,
    distance: 0.3,
    direction: "southbound",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("NtfyClient", () => {
  let client: NtfyClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new NtfyClient({
      server: "https://ntfy.example.com",
      topic: "test-topic",
    });

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatMessage", () => {
    it("formats a southbound crossing event", () => {
      const event = makeCrossingEvent({
        name: "LAKE FREIGHTER",
        speed: 10.2,
        course: 185,
        direction: "southbound",
      });

      const msg = client.formatMessage(event);

      expect(msg.topic).toBe("test-topic");
      expect(msg.title).toBe(
        "LAKE FREIGHTER passing under Blue Water Bridge"
      );
      expect(msg.message).toContain("Southbound");
      expect(msg.message).toContain("10.2 knots");
      expect(msg.message).toContain("MMSI: 123456789");
      expect(msg.message).toContain("Course: 185");
      expect(msg.tags).toContain("ship");
      expect(msg.tags).toContain("southbound");
    });

    it("formats a northbound crossing event", () => {
      const event = makeCrossingEvent({
        direction: "northbound",
        course: 5,
      });

      const msg = client.formatMessage(event);

      expect(msg.message).toContain("Northbound");
      expect(msg.tags).toContain("northbound");
    });

    it("includes destination when available", () => {
      const event = makeCrossingEvent({ destination: "DULUTH" });
      const msg = client.formatMessage(event);
      expect(msg.message).toContain("Destination: DULUTH");
    });

    it("includes length when available", () => {
      const event = makeCrossingEvent({ length: 225 });
      const msg = client.formatMessage(event);
      expect(msg.message).toContain("Length: 225m");
    });

    it("excludes destination when not available", () => {
      const event = makeCrossingEvent({ destination: undefined });
      const msg = client.formatMessage(event);
      expect(msg.message).not.toContain("Destination");
    });

    it("excludes length when not available", () => {
      const event = makeCrossingEvent({ length: undefined });
      const msg = client.formatMessage(event);
      expect(msg.message).not.toContain("Length");
    });
  });

  describe("send", () => {
    it("sends POST request to ntfy server", async () => {
      const msg = client.formatMessage(makeCrossingEvent());
      const result = await client.send(msg);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://ntfy.example.com");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.topic).toBe("test-topic");
      expect(body.title).toBeDefined();
    });

    it("includes auth token when configured", async () => {
      client = new NtfyClient({
        server: "https://ntfy.example.com",
        topic: "test-topic",
        token: "my-secret-token",
      });

      const msg = client.formatMessage(makeCrossingEvent());
      await client.send(msg);

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers["Authorization"]).toBe(
        "Bearer my-secret-token"
      );
    });

    it("does not include auth header when no token", async () => {
      const msg = client.formatMessage(makeCrossingEvent());
      await client.send(msg);

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers["Authorization"]).toBeUndefined();
    });

    it("returns false on HTTP error", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      const msg = client.formatMessage(makeCrossingEvent());
      const result = await client.send(msg);
      expect(result).toBe(false);
    });

    it("returns false on network error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const msg = client.formatMessage(makeCrossingEvent());
      const result = await client.send(msg);
      expect(result).toBe(false);
    });
  });

  describe("sendCrossingNotification", () => {
    it("sends a formatted notification", async () => {
      const event = makeCrossingEvent({ name: "MY SHIP" });
      const result = await client.sendCrossingNotification(event);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.title).toContain("MY SHIP");
    });
  });
});
