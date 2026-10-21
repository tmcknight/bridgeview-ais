import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { WebhookClient, SIGNATURE_HEADER } from "../webhook-client.js";
import { BLUE_WATER_BRIDGE } from "../watch-point-detector.js";
import type { PassageEvent } from "../types.js";

function makePassageEvent(overrides: Partial<PassageEvent> = {}): PassageEvent {
  return {
    watchPoint: BLUE_WATER_BRIDGE,
    mmsi: 123456789,
    name: "LAKE FREIGHTER",
    latitude: 42.9982,
    longitude: -82.423,
    speed: 8.5,
    course: 180,
    heading: 182,
    navStatus: 0,
    distance: 0.31234,
    closestApproach: 0.0456,
    predicted: true,
    direction: "southbound",
    timestamp: Date.UTC(2026, 9, 21, 12, 0, 0),
    destination: "DETROIT",
    shipType: 70,
    length: 225,
    beam: 24,
    imo: 1234567,
    callSign: "ABCD",
    ...overrides,
  };
}

describe("WebhookClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatPayload", () => {
    it("maps a passage event to the webhook payload", () => {
      const client = new WebhookClient({ url: "https://example.com/hook" });
      const payload = client.formatPayload(makePassageEvent());

      expect(payload).toEqual({
        event: "vessel.passage",
        timestamp: "2026-10-21T12:00:00.000Z",
        watchPoint: {
          id: "blue-water-bridge",
          name: "Blue Water Bridge",
          latitude: BLUE_WATER_BRIDGE.latitude,
          longitude: BLUE_WATER_BRIDGE.longitude,
          radiusNM: 0.5,
        },
        distanceNM: 0.312,
        closestApproachNM: 0.046,
        timing: "predicted",
        direction: "southbound",
        vessel: {
          mmsi: 123456789,
          name: "LAKE FREIGHTER",
          imo: 1234567,
          callSign: "ABCD",
          shipType: 70,
          destination: "DETROIT",
          lengthM: 225,
          beamM: 24,
          latitude: 42.9982,
          longitude: -82.423,
          speedKnots: 8.5,
          courseDeg: 180,
          headingDeg: 182,
          navStatus: 0,
          navStatusLabel: "Under way using engine",
        },
      });
    });

    it("includes Wikidata details under vessel.wikidata", () => {
      const client = new WebhookClient({ url: "https://example.com/hook" });
      const vesselInfo = { wikidataId: "Q6719625", wikidataUrl: "https://www.wikidata.org/wiki/Q6719625", yearBuilt: 1979 };
      const payload = client.formatPayload(makePassageEvent({ vesselInfo }));
      expect(payload.vessel.wikidata).toEqual(vesselInfo);
    });

    it("marks observed passages", () => {
      const client = new WebhookClient({ url: "https://example.com/hook" });
      expect(client.formatPayload(makePassageEvent({ predicted: false })).timing).toBe("observed");
    });

    it("omits the nav status label when status is unknown", () => {
      const client = new WebhookClient({ url: "https://example.com/hook" });
      const payload = client.formatPayload(makePassageEvent({ navStatus: undefined }));
      expect(payload.vessel.navStatusLabel).toBeUndefined();
    });
  });

  describe("sendPassage", () => {
    it("POSTs JSON to the configured URL", async () => {
      const client = new WebhookClient({ url: "https://example.com/hook" });
      const result = await client.sendPassage(makePassageEvent());

      expect(result).toBe(true);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://example.com/hook");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers[SIGNATURE_HEADER]).toBeUndefined();
      expect(JSON.parse(options.body).vessel.mmsi).toBe(123456789);
    });

    it("signs the body with HMAC-SHA256 when a secret is set", async () => {
      const client = new WebhookClient({ url: "https://example.com/hook", secret: "s3cret" });
      await client.sendPassage(makePassageEvent());

      const [, options] = fetchMock.mock.calls[0];
      const expected = createHmac("sha256", "s3cret").update(options.body).digest("hex");
      expect(options.headers[SIGNATURE_HEADER]).toBe(`sha256=${expected}`);
    });

    it("returns false on HTTP error", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" });
      const client = new WebhookClient({ url: "https://example.com/hook" });
      expect(await client.sendPassage(makePassageEvent())).toBe(false);
    });

    it("returns false on network error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));
      const client = new WebhookClient({ url: "https://example.com/hook" });
      expect(await client.sendPassage(makePassageEvent())).toBe(false);
    });
  });
});
