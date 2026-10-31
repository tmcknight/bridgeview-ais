import { describe, it, expect, vi } from "vitest";
import { buildVesselQuery, fetchVesselInfo, parseVesselBinding } from "./wikidata.js";

describe("buildVesselQuery", () => {
  it("matches by MMSI and IMO, skipping invalid numbers", () => {
    const query = buildVesselQuery(366938730, 7514701);
    expect(query).toContain('wdt:P587 "366938730"');
    expect(query).toContain('wdt:P458 "7514701"');
    expect(buildVesselQuery(123, 42)).toBeNull();
  });
});

describe("parseVesselBinding", () => {
  it("builds the photo thumbnail and file page links", () => {
    const info = parseVesselBinding({
      ship: { value: "http://www.wikidata.org/entity/Q6719625" },
      name: { value: "Indiana Harbor" },
      img: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Indiana%20Harbor.jpg" },
      built: { value: "1979-01-01T00:00:00Z" },
      grossTonnage: { value: "35923.4" },
      commons: { value: "Indiana Harbor (ship, 1979)" },
    });
    expect(info).toEqual({
      wikidataId: "Q6719625",
      wikidataUrl: "https://www.wikidata.org/wiki/Q6719625",
      name: "Indiana Harbor",
      imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Indiana%20Harbor.jpg?width=480",
      imagePageUrl: "https://commons.wikimedia.org/wiki/File:Indiana%20Harbor.jpg",
      yearBuilt: 1979,
      grossTonnage: 35923,
      commonsCategory: "Indiana Harbor (ship, 1979)",
    });
  });
});

describe("fetchVesselInfo", () => {
  const respond = (body, ok = true) => vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body });

  it("returns the match, or null for none", async () => {
    const match = respond({ results: { bindings: [{ ship: { value: "http://www.wikidata.org/entity/Q1" } }] } });
    expect((await fetchVesselInfo(366938730, undefined, match)).wikidataId).toBe("Q1");
    const [url, init] = match.mock.calls[0];
    expect(url).toMatch(/^https:\/\/query\.wikidata\.org\/sparql\?format=json&query=/);
    expect(init.headers["User-Agent"]).toMatch(/^BridgeViewAIS/);

    expect(await fetchVesselInfo(366938730, undefined, respond({ results: { bindings: [] } }))).toBeNull();
  });

  it("rejects when Wikidata fails, so the lookup is retried", async () => {
    await expect(fetchVesselInfo(366938730, undefined, respond({}, false))).rejects.toThrow("503");
  });
});
