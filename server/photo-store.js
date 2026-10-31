import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Where photos uploaded on the admin page (server/admin-api.js) are kept:
//
//   local  files in PHOTOS_DIR, served from /api/photos/ by this server
//   R2     a Cloudflare R2 bucket, served from its public domain
//          (PHOTOS_PUBLIC_URL), uploaded with R2's S3 API (no SDK; requests
//          signed with AWS Signature Version 4)
//
// Each store has save(bytes, type) -> URL, owns(url) and remove(url). New
// uploads go to R2 when it's set up; photos already in either store keep
// being served and can still be removed. Photos shared from the iOS app go
// only to R2, in its own folder (save(bytes, type, "shared")).

export const PHOTO_TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const PHOTO_FILE = /^([a-f0-9]{32})\.(jpg|png|webp)$/;
const LOCAL_URL = /^\/api\/photos\/([a-f0-9]{32}\.(?:jpg|png|webp))$/;
// Uploaded photos never change (each gets a new name), so they can be cached for good
const IMMUTABLE = "public, max-age=31536000, immutable";
const R2_TIMEOUT_MS = 30_000;

// The image type from a file's first bytes; undefined for anything else
export function photoType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "webp";
  }
  return undefined;
}

// JPEG segments that carry metadata rather than the picture: APP1 (EXIF, with
// GPS position and camera, and XMP), APP13 (IPTC) and comments
const METADATA_SEGMENTS = new Set([0xe1, 0xed, 0xfe]);

// A JPEG without its metadata segments; the picture's own bytes are untouched.
// Returned as it is when it can't be read as a JPEG.
export function stripJpegMetadata(bytes) {
  if (photoType(bytes) !== "jpg") return bytes;
  const kept = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes;
    const marker = bytes[i + 1];
    // Start of scan: the compressed picture follows, to the end
    if (marker === 0xda) {
      kept.push(bytes.subarray(i));
      return Buffer.concat(kept);
    }
    const end = i + 2 + bytes.readUInt16BE(i + 2);
    if (end > bytes.length) return bytes;
    if (!METADATA_SEGMENTS.has(marker)) kept.push(bytes.subarray(i, end));
    i = end;
  }
  return bytes;
}

// Start-of-frame markers, which carry the picture's size: C0-CF except C4
// (Huffman tables), C8 (reserved) and CC (arithmetic coding)
const isStartOfFrame = (marker) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

// Reads a JPEG's structure: it must have one frame and a scan and end with an
// end-of-image marker. Returns { width, height, end }, where end is just past
// that marker (anything after it, such as an iPhone's HDR gain map or data
// hidden there, isn't part of the picture), or { error }.
export function inspectJpeg(bytes) {
  const invalid = { error: "not a complete JPEG" };
  if (photoType(bytes) !== "jpg") return invalid;
  let i = 2;
  let size;
  while (true) {
    if (i + 4 > bytes.length || bytes[i] !== 0xff) return invalid;
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) return invalid;
    if (isStartOfFrame(marker)) {
      if (size || length < 7) return invalid;
      size = { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
    if (marker === 0xda) break;
  }
  if (!size || size.width === 0 || size.height === 0) return invalid;
  // Compressed data can't hold FF D9 (a data FF is followed by 00), so the
  // first one after the scan ends the picture
  const eoi = bytes.indexOf(Buffer.from([0xff, 0xd9]), i);
  if (eoi < 0) return invalid;
  return { ...size, end: eoi + 2 };
}

const newFileName = (type) => `${crypto.randomBytes(16).toString("hex")}.${type}`;

export function createLocalPhotoStore({ dir, logger }) {
  return {
    async save(bytes, type) {
      const file = newFileName(type);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, file), bytes);
      return `/api/photos/${file}`;
    },

    owns(url) {
      return LOCAL_URL.test(url);
    },

    async remove(url) {
      const file = LOCAL_URL.exec(url)?.[1];
      if (!file) return;
      try {
        await fs.promises.rm(path.join(dir, file), { force: true });
      } catch (err) {
        logger?.warn(`[photos] could not delete ${file}: ${err.message}`);
      }
    },

    // Sends /api/photos/<file> to anyone who asks
    serve(req, res, file) {
      const match = PHOTO_FILE.exec(file);
      const notFound = () => {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Not found" }));
      };
      if (!match || (req.method !== "GET" && req.method !== "HEAD")) return notFound();
      const stream = fs.createReadStream(path.join(dir, file));
      stream.on("open", () => {
        res.writeHead(200, {
          "content-type": PHOTO_TYPES[match[2]],
          "cache-control": IMMUTABLE,
          "x-content-type-options": "nosniff",
        });
        if (req.method === "HEAD") {
          stream.destroy();
          res.end();
        } else {
          stream.pipe(res);
        }
      });
      stream.on("error", () => {
        if (!res.headersSent) notFound();
        else res.destroy();
      });
    },
  };
}

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

// Headers for a request signed with AWS Signature Version 4 (no query
// string), including the given ones; `date` is when it's signed
export function signRequest({ method, host, path: requestPath, headers = {}, payloadHash, region, service, accessKeyId, secretAccessKey, date }) {
  const amzDate = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(all).map((name) => name.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));
  const signedHeaders = names.join(";");
  const canonical = [
    method,
    requestPath,
    "",
    ...names.map((name) => `${name}:${lower[name]}`),
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = [day, region, service, "aws4_request"].reduce(hmac, `AWS4${secretAccessKey}`);
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// R2's S3 endpoint, and where its photos are served: <publicUrl>/<folder>/<file>,
// folder "ships" for admin uploads or "shared" for photos shared from the app
export function createR2PhotoStore({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucket,
  publicUrl,
  fetch = globalThis.fetch,
  now = () => new Date(),
}) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const base = publicUrl.replace(/\/+$/, "");
  const FOLDERS = ["ships", "shared"];
  // The bucket key of a photo URL this store made, or undefined
  const keyOf = (url) => {
    if (typeof url !== "string" || !url.startsWith(`${base}/`)) return undefined;
    const key = url.slice(base.length + 1);
    const [folder, file, ...rest] = key.split("/");
    return FOLDERS.includes(folder) && rest.length === 0 && PHOTO_FILE.test(file ?? "") ? key : undefined;
  };

  async function send(method, key, body, headers = {}) {
    const requestPath = `/${encodeURIComponent(bucket)}/${key}`;
    const signed = signRequest({
      method,
      host,
      path: requestPath,
      headers,
      payloadHash: sha256(body ?? ""),
      region: "auto",
      service: "s3",
      accessKeyId,
      secretAccessKey,
      date: now(),
    });
    const { host: _host, ...sent } = signed;
    const res = await fetch(`https://${host}${requestPath}`, {
      method,
      headers: sent,
      body,
      signal: AbortSignal.timeout(R2_TIMEOUT_MS),
    });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      const text = await res.text().catch(() => "");
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      throw new Error(`R2 ${method} failed: ${res.status}${code ? ` ${code}` : ""}`);
    }
  }

  return {
    async save(bytes, type, folder = "ships") {
      if (!FOLDERS.includes(folder)) throw new Error(`Unknown photo folder: ${folder}`);
      const key = `${folder}/${newFileName(type)}`;
      await send("PUT", key, bytes, {
        "content-type": PHOTO_TYPES[type],
        "cache-control": IMMUTABLE,
      });
      return `${base}/${key}`;
    },

    owns(url) {
      return keyOf(url) !== undefined;
    },

    async remove(url) {
      const key = keyOf(url);
      if (key) await send("DELETE", key);
    },
  };
}

// The R2 store from the environment, null when R2 isn't set up, or { error }
// when it's half set up
export function r2ConfigFromEnv(env) {
  const config = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicUrl: env.PHOTOS_PUBLIC_URL,
  };
  const missing = Object.entries({
    R2_ACCOUNT_ID: config.accountId,
    R2_ACCESS_KEY_ID: config.accessKeyId,
    R2_SECRET_ACCESS_KEY: config.secretAccessKey,
    R2_BUCKET: config.bucket,
    PHOTOS_PUBLIC_URL: config.publicUrl,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length === 5) return null;
  if (missing.length > 0) return { error: `R2 photo storage needs ${missing.join(", ")}` };
  if (!/^[a-f0-9]{32}$/.test(config.accountId)) return { error: "R2_ACCOUNT_ID should be 32 hex characters" };
  try {
    if (new URL(config.publicUrl).protocol !== "https:") return { error: "PHOTOS_PUBLIC_URL must be https" };
  } catch {
    return { error: "PHOTOS_PUBLIC_URL must be a URL" };
  }
  return { config };
}
