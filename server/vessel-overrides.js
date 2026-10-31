// Corrections made on the admin page (server/admin-api.js), kept apart from the
// lookups so they survive each ship's next one. Applied to a ship's VesselInfo
// when it's read:
//
//   fields        values that replace the lookups' (e.g. a wrong operator)
//   addedPhotos   photos added by hand (uploaded or linked), shown first
//   hiddenPhotos  photo URLs left out (a wrong ship, a poor shot)
//   primaryPhoto  the photo URL to show first

// Fields that can be set by hand, and the type of each
export const OVERRIDE_FIELDS = {
  name: "string",
  description: "string",
  builder: "string",
  operator: "string",
  wikipediaUrl: "url",
  yearBuilt: "year",
  grossTonnage: "number",
};

export const MAX_ADDED_PHOTOS = 20;
const MAX_HIDDEN_PHOTOS = 200;
const MAX_TEXT = 500;

// The photo URLs a ship may use: http(s), or one uploaded to this server
export function isPhotoUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return false;
  if (/^\/api\/photos\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(value)) return true;
  return isWebUrl(value);
}

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseField(type, value) {
  if (type === "number" || type === "year") {
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(n) || n < 0) return { error: "must be a positive number" };
    if (type === "year" && (!Number.isInteger(n) || n < 1800 || n > 2100)) return { error: "must be a year" };
    return { value: n };
  }
  if (typeof value !== "string") return { error: "must be text" };
  const text = value.trim();
  if (!text) return {};
  if (text.length > MAX_TEXT) return { error: `must be at most ${MAX_TEXT} characters` };
  if (type === "url" && !isWebUrl(text)) return { error: "must be an http(s) URL" };
  return { value: text };
}

function parsePhoto(photo) {
  if (!photo || typeof photo !== "object" || !isPhotoUrl(photo.url)) return { error: "needs an http(s) url" };
  const parsed = { url: photo.url };
  for (const key of ["pageUrl", "title", "artist", "license"]) {
    if (photo[key] === undefined || photo[key] === null || photo[key] === "") continue;
    const { value, error } = parseField(key === "pageUrl" ? "url" : "string", photo[key]);
    if (error) return { error: `${key} ${error}` };
    if (value !== undefined) parsed[key] = value;
  }
  if (photo.year !== undefined && photo.year !== null && photo.year !== "") {
    const { value, error } = parseField("year", photo.year);
    if (error) return { error: `year ${error}` };
    parsed.year = value;
  }
  return { photo: parsed };
}

// Overrides from the admin page's JSON, or { error } describing what's wrong.
// Empty fields and lists are dropped, so {} means no overrides.
export function parseOverrides(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Expected an object" };
  const overrides = {};

  if (body.fields !== undefined) {
    if (!body.fields || typeof body.fields !== "object") return { error: "fields must be an object" };
    const fields = {};
    for (const [key, value] of Object.entries(body.fields)) {
      const type = OVERRIDE_FIELDS[key];
      if (!type) return { error: `Unknown field: ${key}` };
      if (value === null || value === undefined || value === "") continue;
      const parsed = parseField(type, value);
      if (parsed.error) return { error: `${key} ${parsed.error}` };
      if (parsed.value !== undefined) fields[key] = parsed.value;
    }
    if (Object.keys(fields).length > 0) overrides.fields = fields;
  }

  if (body.addedPhotos !== undefined) {
    if (!Array.isArray(body.addedPhotos)) return { error: "addedPhotos must be a list" };
    if (body.addedPhotos.length > MAX_ADDED_PHOTOS) return { error: `At most ${MAX_ADDED_PHOTOS} added photos` };
    const photos = [];
    for (const photo of body.addedPhotos) {
      const parsed = parsePhoto(photo);
      if (parsed.error) return { error: `Added photo ${parsed.error}` };
      if (!photos.some((p) => p.url === parsed.photo.url)) photos.push(parsed.photo);
    }
    if (photos.length > 0) overrides.addedPhotos = photos;
  }

  if (body.hiddenPhotos !== undefined) {
    if (!Array.isArray(body.hiddenPhotos) || body.hiddenPhotos.length > MAX_HIDDEN_PHOTOS) {
      return { error: "hiddenPhotos must be a list of URLs" };
    }
    if (!body.hiddenPhotos.every(isPhotoUrl)) return { error: "hiddenPhotos must be a list of URLs" };
    if (body.hiddenPhotos.length > 0) overrides.hiddenPhotos = [...new Set(body.hiddenPhotos)];
  }

  if (body.primaryPhoto !== undefined && body.primaryPhoto !== null && body.primaryPhoto !== "") {
    if (!isPhotoUrl(body.primaryPhoto)) return { error: "primaryPhoto must be a URL" };
    overrides.primaryPhoto = body.primaryPhoto;
  }

  return { overrides };
}

export function hasOverrides(overrides) {
  return Boolean(overrides) && Object.keys(overrides).length > 0;
}

// The ship's VesselInfo with the overrides applied. With none, info is
// returned as it is (undefined stays undefined, so the browser can look the
// ship up itself).
export function applyOverrides(info, overrides) {
  if (!hasOverrides(overrides)) return info;
  const result = { ...info, ...overrides.fields };

  const touchesPhotos = overrides.addedPhotos || overrides.hiddenPhotos || overrides.primaryPhoto;
  if (touchesPhotos) {
    const hidden = new Set(overrides.hiddenPhotos ?? []);
    const looked = info?.photos ?? (info?.imageUrl ? [{ url: info.imageUrl, pageUrl: info.imagePageUrl }] : []);
    const photos = [];
    for (const photo of [...(overrides.addedPhotos ?? []), ...looked]) {
      if (!hidden.has(photo.url) && !photos.some((p) => p.url === photo.url)) photos.push(photo);
    }
    const primary = photos.findIndex((p) => p.url === overrides.primaryPhoto);
    if (primary > 0) photos.unshift(...photos.splice(primary, 1));

    if (photos.length > 0) result.photos = photos;
    else delete result.photos;
    // Clients that only know one photo show the first
    if (photos[0]) {
      result.imageUrl = photos[0].url;
      if (photos[0].pageUrl) result.imagePageUrl = photos[0].pageUrl;
      else delete result.imagePageUrl;
    } else {
      delete result.imageUrl;
      delete result.imagePageUrl;
    }
  }
  return result;
}
