import { describe, it, expect, vi } from "vitest";
import { completeVesselInfo, createInfoFetcher } from "./vessel-info.js";

vi.mock("./wikidata.js", () => ({
  fetchVesselInfo: vi.fn(async (mmsi) => (mmsi === 1 ? { wikidataId: "Q1", wikidataUrl: "https://www.wikidata.org/wiki/Q1" } : null)),
}));

const WIKIDATA = { wikidataId: "Q1", wikidataUrl: "https://www.wikidata.org/wiki/Q1" };
const USCG = { source: "uscg", vesselId: 7, yearBuilt: 2003, grossTonnage: 23895, deadweight: 36480 };
const TC = { source: "transport-canada", yearBuilt: 2012, grossTonnage: 24451.4 };

describe("createInfoFetcher", () => {
  it("stores Wikidata and USCG details together", async () => {
    const fetchUscg = vi.fn(async () => USCG);
    const fetchInfo = createInfoFetcher({ fetchUscg });
    expect(await fetchInfo(1, { imo: 9613927, callSign: "XJBH" })).toEqual({ ...WIKIDATA, uscg: USCG });
    expect(fetchUscg).toHaveBeenCalledWith({ imo: 9613927, callSign: "XJBH" });
    expect(await fetchInfo(2, { imo: 9613927, callSign: "XJBH" })).toEqual({ uscg: USCG });
  });

  it("is null when neither has the ship, and fails when either lookup does", async () => {
    expect(await createInfoFetcher({ fetchUscg: async () => null })(2)).toBeNull();
    expect(await createInfoFetcher({ wikidata: false })(1)).toBeNull();
    const failing = createInfoFetcher({ fetchUscg: async () => Promise.reject(new Error("PSIX down")) });
    await expect(failing(1)).rejects.toThrow("PSIX down");
  });

  it("adds Commons photos, with Wikidata's first and its category passed on", async () => {
    const { fetchVesselInfo } = await import("./wikidata.js");
    vi.mocked(fetchVesselInfo).mockResolvedValueOnce({
      ...WIKIDATA,
      name: "Indiana Harbor",
      imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Wiki.jpg?width=480",
      imagePageUrl: "https://commons.wikimedia.org/wiki/File:Wiki.jpg",
      commonsCategory: "Indiana Harbor (ship, 1979)",
    });
    const photo = { url: "https://thumb/a.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg", artist: "Pete" };
    const fetchPhotos = vi.fn(async () => [photo]);
    const info = await createInfoFetcher({ fetchPhotos })(1, { imo: 7514701, name: "INDIANA HARBOR" });
    expect(fetchPhotos).toHaveBeenCalledWith({
      imo: 7514701,
      category: "Indiana Harbor (ship, 1979)",
      name: "Indiana Harbor",
      preferredFile: "https://commons.wikimedia.org/wiki/File:Wiki.jpg",
    });
    expect(info.photos).toEqual([
      { url: "https://commons.wikimedia.org/wiki/Special:FilePath/Wiki.jpg?width=480", pageUrl: "https://commons.wikimedia.org/wiki/File:Wiki.jpg" },
      photo,
    ]);
    expect(info.commonsCategory).toBeUndefined();

    expect(await createInfoFetcher({ wikidata: false, fetchPhotos })(2, { name: "LAKER" })).toEqual({ photos: [photo] });
  });
});

describe("completeVesselInfo", () => {
  it("shows the best photo to clients that know only one", () => {
    const photo = { url: "https://thumb/a.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" };
    expect(completeVesselInfo({ photos: [photo] })).toMatchObject({ imageUrl: photo.url, imagePageUrl: photo.pageUrl });
  });

  it("fills Wikidata's gaps from Transport Canada first, then the USCG", () => {
    expect(completeVesselInfo({ ...WIKIDATA, uscg: USCG }, TC)).toEqual({
      ...WIKIDATA,
      uscg: USCG,
      registry: TC,
      yearBuilt: 2012,
      grossTonnage: 24451,
    });
    expect(completeVesselInfo({ uscg: USCG })).toEqual({ uscg: USCG, yearBuilt: 2003, grossTonnage: 23895 });
  });

  it("keeps Wikidata's own values", () => {
    expect(completeVesselInfo({ ...WIKIDATA, yearBuilt: 2013 }, TC).yearBuilt).toBe(2013);
  });

  it("turns no match into details when the register has the ship, but not 'not looked up yet'", () => {
    expect(completeVesselInfo(null, TC)).toEqual({ registry: TC, yearBuilt: 2012, grossTonnage: 24451 });
    expect(completeVesselInfo(null, undefined)).toBeNull();
    expect(completeVesselInfo(undefined, TC)).toBeUndefined();
  });
});
