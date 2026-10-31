import { describe, it, expect } from "vitest";
import { applyOverrides, isPhotoUrl, parseOverrides } from "./vessel-overrides.js";

const COMMONS = (n) => ({ url: `https://upload.wikimedia.org/${n}.jpg`, pageUrl: `https://commons.wikimedia.org/wiki/File:${n}.jpg` });
const UPLOADED = `/api/photos/${"a".repeat(32)}.jpg`;

describe("parseOverrides", () => {
  it("keeps set fields and drops empty ones", () => {
    const { overrides } = parseOverrides({
      fields: { operator: "  Algoma Central ", builder: "", yearBuilt: "1980", grossTonnage: 20000, description: null },
    });
    expect(overrides).toEqual({ fields: { operator: "Algoma Central", yearBuilt: 1980, grossTonnage: 20000 } });
  });

  it("returns {} when nothing is set", () => {
    expect(parseOverrides({ fields: {}, addedPhotos: [], hiddenPhotos: [], primaryPhoto: "" })).toEqual({ overrides: {} });
  });

  it("rejects unknown fields and bad values", () => {
    expect(parseOverrides({ fields: { mmsi: 1 } }).error).toMatch(/Unknown field/);
    expect(parseOverrides({ fields: { yearBuilt: "soon" } }).error).toMatch(/yearBuilt/);
    expect(parseOverrides({ fields: { wikipediaUrl: "javascript:alert(1)" } }).error).toMatch(/URL/);
    expect(parseOverrides({ addedPhotos: [{ url: "data:image/png;base64,xx" }] }).error).toMatch(/url/);
    expect(parseOverrides({ hiddenPhotos: ["nope"] }).error).toBeDefined();
    expect(parseOverrides([]).error).toBeDefined();
  });

  it("keeps photo credits and drops duplicate photos", () => {
    const { overrides } = parseOverrides({
      addedPhotos: [
        { url: UPLOADED, artist: "Me", license: "CC BY 4.0", year: "2025", extra: "x" },
        { url: UPLOADED },
      ],
    });
    expect(overrides.addedPhotos).toEqual([{ url: UPLOADED, artist: "Me", license: "CC BY 4.0", year: 2025 }]);
  });

  it("accepts web URLs and this server's uploads as photo URLs", () => {
    expect(isPhotoUrl("https://example.com/a.jpg")).toBe(true);
    expect(isPhotoUrl(UPLOADED)).toBe(true);
    expect(isPhotoUrl("/api/photos/../../etc/passwd")).toBe(false);
    expect(isPhotoUrl("ftp://example.com/a.jpg")).toBe(false);
  });
});

describe("applyOverrides", () => {
  const info = { wikidataId: "Q1", operator: "Old", photos: [COMMONS(1), COMMONS(2)], imageUrl: COMMONS(1).url, imagePageUrl: COMMONS(1).pageUrl };

  it("leaves info alone without overrides", () => {
    expect(applyOverrides(info, {})).toBe(info);
    expect(applyOverrides(undefined, undefined)).toBeUndefined();
  });

  it("replaces fields", () => {
    expect(applyOverrides(info, { fields: { operator: "New" } }).operator).toBe("New");
  });

  it("adds, hides and reorders photos, keeping imageUrl on the first", () => {
    const result = applyOverrides(info, {
      addedPhotos: [{ url: UPLOADED, artist: "Me" }],
      hiddenPhotos: [COMMONS(1).url],
      primaryPhoto: COMMONS(2).url,
    });
    expect(result.photos.map((p) => p.url)).toEqual([COMMONS(2).url, UPLOADED]);
    expect(result.imageUrl).toBe(COMMONS(2).url);
    expect(result.imagePageUrl).toBe(COMMONS(2).pageUrl);
  });

  it("drops the photo entirely when every one is hidden", () => {
    const result = applyOverrides(info, { hiddenPhotos: [COMMONS(1).url, COMMONS(2).url] });
    expect(result.photos).toBeUndefined();
    expect(result.imageUrl).toBeUndefined();
    expect(result.imagePageUrl).toBeUndefined();
  });

  it("hides Wikidata's one photo when there's no list", () => {
    const result = applyOverrides({ imageUrl: COMMONS(1).url, imagePageUrl: COMMONS(1).pageUrl }, { hiddenPhotos: [COMMONS(1).url] });
    expect(result.imageUrl).toBeUndefined();
  });

  it("gives a ship nobody knows details of its own", () => {
    expect(applyOverrides(null, { fields: { name: "Ship" } })).toEqual({ name: "Ship" });
  });
});
