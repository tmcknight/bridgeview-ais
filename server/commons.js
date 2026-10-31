import { isValidImo } from "./wikidata.js";

// Ship photos from Wikimedia Commons. Commons files each ship under
// "Category:IMO 1234567", usually through one subcategory per ship
// ("Category:Algoma Equinox (ship, 2013)"); Wikidata's Commons category (P373)
// finds ships without an IMO category. Each photo keeps its artist and
// licence, which most Commons licences require shown with it.

const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "BridgeViewAIS/1.0 (https://github.com/tmcknight/bridgeview-ais)";
const THUMBNAIL_WIDTH = 480;
export const MAX_PHOTOS = 12;
// Categories to read files from: the IMO category, its ship subcategories, Wikidata's
const MAX_CATEGORIES = 4;
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/tiff"]);

async function query(params, fetchImpl) {
  const url = `${API}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params })}`;
  const response = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Commons query failed: ${response.status}`);
  return response.json();
}

function stripHtml(text) {
  return text
    ?.replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// "File:Indiana_Harbor%20001.jpg" or a file page URL -> "Indiana Harbor 001.jpg"
export function fileName(titleOrUrl) {
  if (!titleOrUrl) return undefined;
  const name = titleOrUrl.split(/File:/).pop();
  try {
    return decodeURIComponent(name).replace(/_/g, " ");
  } catch {
    return name.replace(/_/g, " ");
  }
}

// A Commons file page from the API as a VesselPhoto (src/types/vessel.ts), or
// null for files that aren't photos (drawings, maps, PDFs)
export function parsePhoto(page) {
  const info = page.imageinfo?.[0];
  if (!info?.thumburl || !PHOTO_MIME_TYPES.has(info.mime)) return null;
  const meta = info.extmetadata ?? {};
  const photo = {
    // Commons adds tracking parameters to thumbnail URLs
    url: info.thumburl.replace(/\?utm_[^#]*$/, ""),
    pageUrl: info.descriptionurl,
    title: fileName(page.title)?.replace(/\.[a-z]+$/i, ""),
    artist: stripHtml(meta.Artist?.value) || undefined,
    license: stripHtml(meta.LicenseShortName?.value) || undefined,
  };
  const year = /\b(1[89]\d\d|20\d\d)\b/.exec(meta.DateTimeOriginal?.value ?? "")?.[1];
  if (year) photo.year = Number(year);
  return Object.fromEntries(Object.entries(photo).filter(([, v]) => v !== undefined));
}

// Wikidata's own photo first, then photos named after the ship (others may
// show it in the background of a harbour view), then the newest
export function rankPhotos(photos, { name, preferredFile } = {}) {
  const preferred = fileName(preferredFile);
  const words = (name ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const named = (p) => words.length > 0 && words.every((w) => p.title?.toLowerCase().includes(w));
  const score = (p) => (fileName(p.pageUrl) === preferred ? 2 : named(p) ? 1 : 0);
  return [...photos].sort((a, b) => score(b) - score(a) || (b.year ?? 0) - (a.year ?? 0));
}

const IMAGE_INFO = {
  prop: "imageinfo",
  iiprop: "url|mime|extmetadata",
  iiextmetadatafilter: "Artist|LicenseShortName|DateTimeOriginal",
  iiurlwidth: String(THUMBNAIL_WIDTH),
};
// Results for the admin page's photo search
export const MAX_SEARCH_RESULTS = 30;

// Photos on Commons matching free text, best match first, for the admin page:
// finds photos filed outside a ship's IMO category, e.g. under a former name
export async function searchCommonsPhotos(text, fetchImpl = fetch) {
  const data = await query(
    {
      generator: "search",
      gsrsearch: `${text} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: String(MAX_SEARCH_RESULTS),
      ...IMAGE_INFO,
    },
    fetchImpl
  );
  // Generator results come unordered, with their search rank as `index`
  return (data.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(parsePhoto)
    .filter(Boolean);
}

// Resolves to the ship's photos (at most MAX_PHOTOS, best first), [] when
// Commons has none. Rejects when Commons can't be reached.
export async function fetchCommonsPhotos({ imo, category, name, preferredFile } = {}, fetchImpl = fetch) {
  const categories = [];
  const pages = [];
  if (isValidImo(imo)) {
    const data = await query(
      { list: "categorymembers", cmtitle: `Category:IMO ${imo}`, cmtype: "subcat|file", cmlimit: "50" },
      fetchImpl
    );
    const members = data.query?.categorymembers ?? [];
    categories.push(`Category:IMO ${imo}`, ...members.filter((m) => m.ns === 14).map((m) => m.title));
  }
  if (category) categories.push(category.startsWith("Category:") ? category : `Category:${category}`);

  const seen = new Set();
  for (const title of [...new Set(categories)].slice(0, MAX_CATEGORIES)) {
    const data = await query(
      {
        generator: "categorymembers",
        gcmtitle: title,
        gcmtype: "file",
        gcmlimit: "50",
        ...IMAGE_INFO,
      },
      fetchImpl
    );
    for (const page of data.query?.pages ?? []) {
      if (seen.has(page.title)) continue;
      seen.add(page.title);
      pages.push(page);
    }
  }

  const photos = pages.map(parsePhoto).filter(Boolean);
  return rankPhotos(photos, { name, preferredFile }).slice(0, MAX_PHOTOS);
}
