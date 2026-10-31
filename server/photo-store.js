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
// being served and can still be removed.

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

// R2's S3 endpoint, and where its photos are served: <publicUrl>/ships/<file>
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
  const prefix = `${base}/ships/`;

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
    async save(bytes, type) {
      const file = newFileName(type);
      await send("PUT", `ships/${file}`, bytes, {
        "content-type": PHOTO_TYPES[type],
        "cache-control": IMMUTABLE,
      });
      return `${prefix}${file}`;
    },

    owns(url) {
      return typeof url === "string" && url.startsWith(prefix) && PHOTO_FILE.test(url.slice(prefix.length));
    },

    async remove(url) {
      if (!this.owns(url)) return;
      await send("DELETE", `ships/${url.slice(prefix.length)}`);
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
