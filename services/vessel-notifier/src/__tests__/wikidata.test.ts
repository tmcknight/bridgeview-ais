import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildVesselQuery, parseVesselBinding, VesselInfoLookup } from "../wikidata.js";

const literal = (value: string) => ({ type: "literal", value });
const uri = (value: string) => ({ type: "uri", value });

const indianaHarborRow = {
  ship: uri("http://www.wikidata.org/entity/Q6719625"),
  name: literal("Indiana Harbor"),
  description: literal("self-discharging bulk carrier"),
  img: uri("http://commons.wikimedia.org/wiki/Special:FilePath/Lakers%20Indiana%20Harbor.jpg"),
  built: literal("1979-01-01T00:00:00Z"),
  builder: literal("Bay Shipbuilding Company"),
  grossTonnage: literal("35923.0"),
  wiki: uri("https://en.wikipedia.org/wiki/MV_Indiana_Harbor"),
};

function sparqlResponse(bindings: Record<string, unknown>[], ok = true, status = 200) {
  return { ok, status, json: async () => ({ results: { bindings } }) };
}

describe("buildVesselQuery", () => {
  it("matches on MMSI or IMO when both are given", () => {
    expect(buildVesselQuery(366938730, 7514701)).toContain(
      '{ ?ship wdt:P587 "366938730" } UNION { ?ship wdt:P458 "7514701" }'
    );
  });

  it("returns null for invalid identifiers", () => {
    expect(buildVesselQuery(12345)).toBeNull();
    expect(buildVesselQuery(undefined, 0)).toBeNull();
  });
});

describe("parseVesselBinding", () => {
  it("maps a full result row to VesselInfo", () => {
    expect(parseVesselBinding(indianaHarborRow)).toEqual({
      wikidataId: "Q6719625",
      wikidataUrl: "https://www.wikidata.org/wiki/Q6719625",
      name: "Indiana Harbor",
      description: "self-discharging bulk carrier",
      imageUrl:
        "https://commons.wikimedia.org/wiki/Special:FilePath/Lakers%20Indiana%20Harbor.jpg?width=480",
      imagePageUrl: "https://commons.wikimedia.org/wiki/File:Lakers%20Indiana%20Harbor.jpg",
      yearBuilt: 1979,
      builder: "Bay Shipbuilding Company",
      grossTonnage: 35923,
      wikipediaUrl: "https://en.wikipedia.org/wiki/MV_Indiana_Harbor",
    });
  });

  it("returns null without a ship URI", () => {
    expect(parseVesselBinding({})).toBeNull();
  });
});

describe("VesselInfoLookup", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let lookup: VesselInfoLookup;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(sparqlResponse([indianaHarborRow]));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    lookup = new VesselInfoLookup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves vessel details and identifies itself to Wikimedia", async () => {
    const info = await lookup.get(366938730, 7514701, 1000);
    expect(info?.name).toBe("Indiana Harbor");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("https://query.wikidata.org/sparql");
    expect(options.headers["User-Agent"]).toMatch(/BridgeViewAIS/);
  });

  it("queries each vessel once while cached", async () => {
    lookup.prefetch(366938730);
    lookup.prefetch(366938730);
    await lookup.get(366938730, undefined, 1000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("queries again once the IMO is known", async () => {
    await lookup.get(366938730, undefined, 1000);
    await lookup.get(366938730, 7514701, 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves null when the vessel is not on Wikidata", async () => {
    fetchMock.mockResolvedValueOnce(sparqlResponse([]));
    expect(await lookup.get(366938730, undefined, 1000)).toBeNull();
  });

  it("resolves null without querying for invalid identifiers", async () => {
    expect(await lookup.get(12345, undefined, 1000)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up waiting after the timeout without cancelling the lookup", async () => {
    vi.useFakeTimers();
    let respond!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));

    const pending = lookup.get(366938730, undefined, 1500);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBeNull();

    respond(sparqlResponse([indianaHarborRow]));
    expect((await lookup.get(366938730, undefined, 1500))?.name).toBe("Indiana Harbor");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("resolves null on failure and retries after the failure TTL", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(sparqlResponse([], false, 503));

    expect(await lookup.get(366938730, undefined, 1000)).toBeNull();
    await lookup.get(366938730, undefined, 1000);
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect((await lookup.get(366938730, undefined, 1000))?.name).toBe("Indiana Harbor");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prunes expired entries", async () => {
    vi.useFakeTimers();
    await lookup.get(366938730, undefined, 1000);
    expect(lookup.cacheSize).toBe(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    lookup.prune();
    expect(lookup.cacheSize).toBe(0);
  });
});
