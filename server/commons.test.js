import { describe, it, expect, vi } from "vitest";
import { fetchCommonsPhotos, fileName, MAX_PHOTOS, parsePhoto, rankPhotos, searchCommonsPhotos } from "./commons.js";

function filePage(title, { mime = "image/jpeg", artist = "<a href='x'>Pete Markham</a>", date = "2012-09-01 13:19:40" } = {}) {
  const slug = title.replace(/ /g, "_");
  return {
    title: `File:${title}`,
    imageinfo: [
      {
        mime,
        thumburl: `https://upload.wikimedia.org/thumb/${slug}/500px-${slug}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${slug}`,
        extmetadata: {
          Artist: { value: artist },
          LicenseShortName: { value: "CC BY-SA 2.0" },
          DateTimeOriginal: { value: date },
        },
      },
    ],
  };
}

describe("fileName", () => {
  it("reads file names from titles and page URLs", () => {
    expect(fileName("File:Indiana_Harbor%20001.jpg")).toBe("Indiana Harbor 001.jpg");
    expect(fileName("https://commons.wikimedia.org/wiki/File:A_(ship,_1979).jpg")).toBe("A (ship, 1979).jpg");
    expect(fileName(undefined)).toBeUndefined();
  });
});

describe("parsePhoto", () => {
  it("keeps the thumbnail, file page, credit and year", () => {
    expect(parsePhoto(filePage("Indiana Harbor 001.jpg"))).toEqual({
      url: "https://upload.wikimedia.org/thumb/Indiana_Harbor_001.jpg/500px-Indiana_Harbor_001.jpg",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Indiana_Harbor_001.jpg",
      title: "Indiana Harbor 001",
      artist: "Pete Markham",
      license: "CC BY-SA 2.0",
      year: 2012,
    });
  });

  it("skips files that aren't photos", () => {
    expect(parsePhoto(filePage("Plan.svg", { mime: "image/svg+xml" }))).toBeNull();
    expect(parsePhoto({ title: "File:x.jpg" })).toBeNull();
  });
});

describe("rankPhotos", () => {
  it("puts Wikidata's photo first, then ones named after the ship, newest first", () => {
    const photo = (title, year) => ({ title, year, pageUrl: `https://commons.wikimedia.org/wiki/File:${title.replace(/ /g, "_")}.jpg` });
    const ranked = rankPhotos(
      [photo("Harbour view", 2020), photo("Indiana Harbor old", 2005), photo("Indiana Harbor new", 2018), photo("Official", 2001)],
      { name: "INDIANA HARBOR", preferredFile: "https://commons.wikimedia.org/wiki/File:Official.jpg" }
    );
    expect(ranked.map((p) => p.title)).toEqual(["Official", "Indiana Harbor new", "Indiana Harbor old", "Harbour view"]);
  });
});

describe("searchCommonsPhotos", () => {
  it("searches files for photos, best match first", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        query: {
          pages: [
            { ...filePage("Northern Venture at Sarnia.jpg"), index: 2 },
            { ...filePage("Northern Venture plan.svg", { mime: "image/svg+xml" }), index: 3 },
            { ...filePage("Da Shen 2019.jpg"), index: 1 },
          ],
        },
      }),
    }));
    const photos = await searchCommonsPhotos("Northern Venture", fetchImpl);
    expect(photos.map((p) => p.title)).toEqual(["Da Shen 2019", "Northern Venture at Sarnia"]);
    expect(photos[0]).toMatchObject({ artist: "Pete Markham", license: "CC BY-SA 2.0" });
    const params = new URL(fetchImpl.mock.calls[0][0]).searchParams;
    expect(params.get("gsrsearch")).toBe("Northern Venture filetype:bitmap");
    expect(params.get("gsrnamespace")).toBe("6");
  });

  it("rejects when Commons can't be reached", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
    await expect(searchCommonsPhotos("Northern Venture", fetchImpl)).rejects.toThrow("503");
  });
});

describe("fetchCommonsPhotos", () => {
  // A fake Commons API: the IMO category lists one ship subcategory
  function fakeCommons(filesByCategory) {
    return vi.fn(async (url) => {
      const params = new URL(url).searchParams;
      let body;
      if (params.get("list") === "categorymembers") {
        body = { query: { categorymembers: [{ ns: 14, title: "Category:Indiana Harbor (ship, 1979)" }] } };
      } else {
        body = { query: { pages: filesByCategory[params.get("gcmtitle")] ?? [] } };
      }
      return { ok: true, json: async () => body };
    });
  }

  it("collects photos from the IMO category, its ship subcategory and Wikidata's, without duplicates", async () => {
    const fetchImpl = fakeCommons({
      "Category:IMO 7514701": [filePage("Indiana Harbor A.jpg")],
      "Category:Indiana Harbor (ship, 1979)": [filePage("Indiana Harbor A.jpg"), filePage("Indiana Harbor B.jpg"), filePage("Plan.svg", { mime: "image/svg+xml" })],
      "Category:Lakers": [filePage("Lakers at Duluth.jpg")],
    });
    const photos = await fetchCommonsPhotos({ imo: 7514701, category: "Lakers", name: "Indiana Harbor" }, fetchImpl);
    expect(photos.map((p) => p.title)).toEqual(["Indiana Harbor A", "Indiana Harbor B", "Lakers at Duluth"]);
  });

  it("keeps at most a dozen, and needs an IMO number or a category", async () => {
    const pages = Array.from({ length: 20 }, (_, i) => filePage(`Ship ${i}.jpg`));
    const photos = await fetchCommonsPhotos({ imo: 7514701 }, fakeCommons({ "Category:IMO 7514701": pages }));
    expect(photos).toHaveLength(MAX_PHOTOS);

    const fetchImpl = fakeCommons({});
    expect(await fetchCommonsPhotos({ imo: 42 }, fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails when Commons can't be reached", async () => {
    await expect(fetchCommonsPhotos({ imo: 7514701 }, async () => ({ ok: false, status: 503 }))).rejects.toThrow("503");
  });
});
