import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createLocalPhotoStore,
  createR2PhotoStore,
  inspectJpeg,
  photoType,
  r2ConfigFromEnv,
  signRequest,
  stripJpegMetadata,
} from "./photo-store.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("photoType", () => {
  it("knows JPEG, PNG and WebP by their first bytes", () => {
    expect(photoType(JPEG)).toBe("jpg");
    expect(photoType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(photoType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(photoType(Buffer.from("<svg onload=alert(1)>"))).toBeUndefined();
  });
});

describe("createLocalPhotoStore", () => {
  let dir;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("saves, owns and removes files under /api/photos/", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-"));
    const store = createLocalPhotoStore({ dir });
    const url = await store.save(JPEG, "jpg");
    expect(url).toMatch(/^\/api\/photos\/[a-f0-9]{32}\.jpg$/);
    expect(store.owns(url)).toBe(true);
    expect(store.owns("https://example.com/a.jpg")).toBe(false);
    expect(fs.readdirSync(dir)).toHaveLength(1);
    await store.remove(url);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});

describe("signRequest", () => {
  // AWS's worked example for Signature Version 4 in S3 (GET Object)
  it("matches AWS's example signature", () => {
    const headers = signRequest({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
  });
});

describe("createR2PhotoStore", () => {
  function setup(response = { ok: true, status: 200 }) {
    const fetch = vi.fn().mockResolvedValue({ text: async () => "", ...response });
    const store = createR2PhotoStore({
      accountId: ACCOUNT,
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket: "bridgeview-photos",
      publicUrl: "https://photos.example/",
      fetch,
    });
    return { store, fetch };
  }

  it("uploads to the bucket and returns the public URL", async () => {
    const { store, fetch } = setup();
    const url = await store.save(JPEG, "jpg");
    expect(url).toMatch(/^https:\/\/photos\.example\/ships\/[a-f0-9]{32}\.jpg$/);
    expect(store.owns(url)).toBe(true);

    const [target, init] = fetch.mock.calls[0];
    expect(target).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com/bridgeview-photos/ships/${url.split("/").pop()}`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JPEG);
    expect(init.headers["content-type"]).toBe("image/jpeg");
    expect(init.headers["cache-control"]).toMatch(/immutable/);
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
    expect(init.headers.host).toBeUndefined();
  });

  it("keeps photos shared from the app in their own folder", async () => {
    const { store, fetch } = setup();
    const url = await store.save(JPEG, "jpg", "shared");
    expect(url).toMatch(/^https:\/\/photos\.example\/shared\/[a-f0-9]{32}\.jpg$/);
    expect(fetch.mock.calls[0][0]).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com/bridgeview-photos/shared/${url.split("/").pop()}`);
    expect(store.owns(url)).toBe(true);
    expect(store.owns(`https://photos.example/other/${"c".repeat(32)}.jpg`)).toBe(false);
    expect(store.owns(`https://photos.example/shared/x/${"c".repeat(32)}.jpg`)).toBe(false);
    await store.remove(url);
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
    expect(fetch.mock.calls[1][1].method).toBe("DELETE");
    await expect(store.save(JPEG, "jpg", "../etc")).rejects.toThrow(/folder/);
  });

  it("deletes only its own photos, and doesn't mind ones already gone", async () => {
    const { store, fetch } = setup({ ok: false, status: 404 });
    await store.remove("https://elsewhere.example/ships/a.jpg");
    expect(fetch).not.toHaveBeenCalled();
    await store.remove(`https://photos.example/ships/${"c".repeat(32)}.png`);
    expect(fetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("reports R2's error code", async () => {
    const { store } = setup({ ok: false, status: 403, text: async () => "<Error><Code>AccessDenied</Code></Error>" });
    await expect(store.save(JPEG, "jpg")).rejects.toThrow("R2 PUT failed: 403 AccessDenied");
  });
});

describe("r2ConfigFromEnv", () => {
  const ENV = {
    R2_ACCOUNT_ID: ACCOUNT,
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "bucket",
    PHOTOS_PUBLIC_URL: "https://photos.example",
  };

  it("is off when nothing is set, and complete when everything is", () => {
    expect(r2ConfigFromEnv({})).toBeNull();
    expect(r2ConfigFromEnv(ENV).config.bucket).toBe("bucket");
  });

  it("says what's missing or wrong", () => {
    expect(r2ConfigFromEnv({ ...ENV, R2_BUCKET: "" }).error).toMatch(/R2_BUCKET/);
    expect(r2ConfigFromEnv({ ...ENV, PHOTOS_PUBLIC_URL: "http://photos.example" }).error).toMatch(/https/);
    expect(r2ConfigFromEnv({ ...ENV, R2_ACCOUNT_ID: "nope" }).error).toMatch(/32 hex/);
  });
});

describe("JPEG checks", () => {
  const SOI = [0xff, 0xd8];
  const EXIF = [0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66];
  const ICC = [0xff, 0xe2, 0x00, 0x04, 0x01, 0x02];
  const FRAME = [0xff, 0xc2, 0x00, 0x0b, 8, 0x03, 0x00, 0x04, 0x00, 1, 1, 0x11, 0]; // progressive, 1024×768
  const SCAN = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x12, 0xff, 0x00, 0x34];
  const EOI = [0xff, 0xd9];
  const jpeg = (...parts) => Buffer.from(parts.flat());

  it("strips EXIF but keeps colour profiles and the picture", () => {
    expect(stripJpegMetadata(jpeg(SOI, EXIF, ICC, FRAME, SCAN, EOI))).toEqual(jpeg(SOI, ICC, FRAME, SCAN, EOI));
  });

  it("reads the size and where the picture ends", () => {
    const bytes = jpeg(SOI, ICC, FRAME, SCAN, EOI, [0x50, 0x4b, 0xff, 0xd9]);
    expect(inspectJpeg(bytes)).toEqual({ width: 1024, height: 768, end: SOI.length + ICC.length + FRAME.length + SCAN.length + 2 });
  });

  it.each([
    ["no frame", jpeg(SOI, SCAN, EOI)],
    ["no scan", jpeg(SOI, FRAME, EOI)],
    ["no end", jpeg(SOI, FRAME, SCAN)],
    ["two frames", jpeg(SOI, FRAME, FRAME, SCAN, EOI)],
    ["a segment running past the end", jpeg(SOI, [0xff, 0xe2, 0x10, 0x00], FRAME)],
    ["not a JPEG", Buffer.from("GIF89a")],
  ])("refuses a JPEG with %s", (_, bytes) => {
    expect(inspectJpeg(bytes).error).toBeDefined();
  });
});
