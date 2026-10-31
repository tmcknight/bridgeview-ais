import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createAdminApi, LOGIN_LIMITS, SESSION_MS } from "./admin-api.js";
import { createVesselDetails } from "./vessel-details.js";
import { createPhotoSubmissions } from "./photo-submissions.js";
import { createPhotoReports } from "./photo-reports.js";

const PASSWORD = "correct horse battery";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function staticData(mmsi, name) {
  return {
    MessageType: "ShipStaticData",
    MetaData: { MMSI: mmsi, ShipName: name, latitude: 0, longitude: 0 },
    Message: { ShipStaticData: { Name: name, ImoNumber: 9600000, Type: 70, Dimension: { A: 100, B: 50 } } },
  };
}

// A request/response pair for handleRequest; resolves with the response
function call(api, method, url, { body, token, ip = "1.2.3.4", headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { method, url, headers: { ...headers, ...(token && { authorization: `Bearer ${token}` }) }, destroy() {} });
    const res = new PassThrough();
    const chunks = [];
    Object.assign(res, {
      headersSent: false,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
        this.headersSent = true;
      },
    });
    res.on("data", (c) => chunks.push(c));
    res.on("finish", () => {
      const raw = Buffer.concat(chunks);
      const json = res.headers?.["content-type"]?.startsWith("application/json");
      resolve({ status: res.status, headers: res.headers, body: json ? JSON.parse(raw) : raw });
    });
    const handled = api.handleRequest(req, res, ip);
    if (!handled) resolve(null);
    if (body !== undefined) req.emit("data", Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
}

describe("createAdminApi", () => {
  let vesselDetails;
  let dir;
  let clock;

  afterEach(() => {
    vesselDetails?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup({ password = PASSWORD, fetchInfo, photoStore, searchPhotos } = {}) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-api-"));
    vesselDetails = createVesselDetails({ fetchInfo });
    vesselDetails.handleMessage(staticData(316000001, "LAKER"));
    clock = Date.parse("2026-10-31T12:00:00Z");
    return createAdminApi({ password, vesselDetails, photosDir: path.join(dir, "photos"), photoStore, searchPhotos, now: () => clock });
  }

  async function loggedIn(api) {
    const res = await call(api, "POST", "/api/admin/login", { body: { password: PASSWORD } });
    expect(res.status).toBe(200);
    return res.body.token;
  }

  it("leaves other paths to the next handler", async () => {
    expect(await call(setup(), "GET", "/api/bridge")).toBeNull();
  });

  it("is off without a password", async () => {
    const api = setup({ password: "" });
    expect((await call(api, "POST", "/api/admin/login", { body: { password: "" } })).status).toBe(404);
    expect((await call(api, "GET", "/api/admin/ships")).status).toBe(404);
  });

  it("needs a session for everything but logging in", async () => {
    const api = setup();
    expect((await call(api, "GET", "/api/admin/ships")).status).toBe(401);
    expect((await call(api, "GET", "/api/admin/ships", { token: "made-up" })).status).toBe(401);
    expect((await call(api, "POST", "/api/admin/login", { body: { password: "wrong" } })).status).toBe(401);

    const token = await loggedIn(api);
    const res = await call(api, "GET", "/api/admin/ships?q=lak", { token });
    expect(res.status).toBe(200);
    expect(res.body.ships.map((s) => s.mmsi)).toEqual([316000001]);
    expect(res.body.total).toBe(1);
  });

  it("ends sessions after SESSION_MS and on logout", async () => {
    const api = setup();
    let token = await loggedIn(api);
    clock += SESSION_MS;
    expect((await call(api, "GET", "/api/admin/session", { token })).status).toBe(401);

    token = await loggedIn(api);
    expect((await call(api, "GET", "/api/admin/session", { token })).status).toBe(200);
    expect((await call(api, "POST", "/api/admin/logout", { token })).status).toBe(204);
    expect((await call(api, "GET", "/api/admin/session", { token })).status).toBe(401);
  });

  it("limits login attempts per IP", async () => {
    const api = setup();
    for (let i = 0; i < LOGIN_LIMITS.WRITES; i++) {
      await call(api, "POST", "/api/admin/login", { body: { password: "guess" } });
    }
    const res = await call(api, "POST", "/api/admin/login", { body: { password: PASSWORD } });
    expect(res.status).toBe(429);
    expect((await call(api, "POST", "/api/admin/login", { body: { password: PASSWORD }, ip: "5.6.7.8" })).status).toBe(200);
  });

  it("shows and corrects a ship", async () => {
    const api = setup();
    const token = await loggedIn(api);

    expect((await call(api, "GET", "/api/admin/ships/1", { token })).status).toBe(404);
    const bad = await call(api, "PUT", "/api/admin/ships/316000001/overrides", { token, body: { fields: { yearBuilt: "x" } } });
    expect(bad.status).toBe(400);

    const res = await call(api, "PUT", "/api/admin/ships/316000001/overrides", { token, body: { fields: { operator: "Algoma" } } });
    expect(res.status).toBe(200);
    expect(res.body.info.operator).toBe("Algoma");
    expect(vesselDetails.vesselInfo(316000001).operator).toBe("Algoma");
    expect((await call(api, "GET", "/api/admin/ships/316000001", { token })).body.overrides).toEqual({ fields: { operator: "Algoma" } });
  });

  it("looks a ship up again on request", async () => {
    vi.useFakeTimers();
    try {
      const fetchInfo = vi.fn().mockResolvedValue({ operator: "Found" });
      const api = setup({ fetchInfo });
      const token = await loggedIn(api);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchInfo).toHaveBeenCalledTimes(1);

      expect((await call(api, "POST", "/api/admin/ships/316000001/refresh", { token })).status).toBe(202);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchInfo).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("searches Commons for photos", async () => {
    const photo = { url: "https://upload.wikimedia.org/a.jpg", artist: "Pete Markham", license: "CC BY-SA 2.0" };
    const searchPhotos = vi.fn().mockResolvedValueOnce([photo]).mockRejectedValueOnce(new Error("down"));
    const api = setup({ searchPhotos });
    expect((await call(api, "GET", "/api/admin/photos/search?q=Venture")).status).toBe(401);
    const token = await loggedIn(api);

    const res = await call(api, "GET", "/api/admin/photos/search?q=%20Northern%20Venture%20", { token });
    expect(res.body).toEqual({ photos: [photo] });
    expect(searchPhotos).toHaveBeenCalledWith("Northern Venture");
    expect((await call(api, "GET", "/api/admin/photos/search?q=N", { token })).status).toBe(400);
    expect((await call(api, "GET", "/api/admin/photos/search?q=Northern", { token })).status).toBe(502);
  });

  it("says when lookups are off", async () => {
    const api = setup();
    const token = await loggedIn(api);
    expect((await call(api, "POST", "/api/admin/ships/316000001/refresh", { token })).status).toBe(503);
  });

  it("stores uploaded photos, serves them to anyone, and deletes them once removed", async () => {
    const api = setup();
    const token = await loggedIn(api);

    expect((await call(api, "POST", "/api/admin/ships/316000001/photos", { token, body: Buffer.from("not an image") })).status).toBe(415);

    const res = await call(api, "POST", "/api/admin/ships/316000001/photos?artist=Me&license=CC%20BY%204.0", { token, body: JPEG });
    expect(res.status).toBe(201);
    const [photo] = res.body.overrides.addedPhotos;
    expect(photo).toMatchObject({ artist: "Me", license: "CC BY 4.0" });
    expect(photo.url).toMatch(/^\/api\/photos\/[a-f0-9]{32}\.jpg$/);
    expect(res.body.info.imageUrl).toBe(photo.url);

    const served = await call(api, "GET", photo.url);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/jpeg");
    expect(served.body.equals(JPEG)).toBe(true);
    expect((await call(api, "GET", "/api/photos/..%2Fbridgeview.db")).status).toBe(404);

    await call(api, "PUT", "/api/admin/ships/316000001/overrides", { token, body: { addedPhotos: [] } });
    await vi.waitFor(() => expect(fs.readdirSync(path.join(dir, "photos"))).toEqual([]));
    expect((await call(api, "GET", photo.url)).status).toBe(404);
  });
});

describe("photos shared from the app", () => {
  const DEVICE = "0f8fad5b-d9cb-469f-a165-70867728950e";
  // A JPEG's structure, with an EXIF segment (APP1) and a frame of this size
  function jpeg({ width = 2048, height = 1536, data = [1, 2, 3], after = [] } = {}) {
    const frame = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
    frame.writeUInt16BE(height, 5);
    frame.writeUInt16BE(width, 7);
    return Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe1, 0x00, 0x08]),
      Buffer.from("GPS!!!", "latin1"),
      frame,
      Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, ...data, 0xff, 0xd9, ...after]),
    ]);
  }
  const EXIF_JPEG = jpeg();
  let vesselDetails;
  let photoSubmissions;
  let store;

  afterEach(() => {
    vesselDetails?.close();
    photoSubmissions?.close();
  });

  // Stands in for R2: keeps what's saved, by URL
  function r2Store() {
    const files = new Map();
    let n = 0;
    return {
      files,
      async save(bytes, type, folder = "ships") {
        const url = `https://photos.example/${folder}/${String(n++).padStart(32, "a")}.${type}`;
        files.set(url, bytes);
        return url;
      },
      owns: (url) => url.startsWith("https://photos.example/"),
      remove: vi.fn(async (url) => files.delete(url)),
    };
  }

  async function setup({ password = PASSWORD, r2 = true } = {}) {
    vesselDetails = createVesselDetails();
    vesselDetails.handleMessage(staticData(316000001, "LAKER"));
    photoSubmissions = createPhotoSubmissions();
    store = r2 ? r2Store() : null;
    const api = createAdminApi({ password, vesselDetails, photosDir: "/nonexistent", photoStore: store, photoSubmissions });
    const token = password ? (await call(api, "POST", "/api/admin/login", { body: { password } })).body.token : undefined;
    return { api, token };
  }

  const share = (api, opts = {}) =>
    call(api, "POST", "/api/ships/316000001/photos?artist=Jo%20Doe&note=From%20the%20park", { body: EXIF_JPEG, headers: { "x-bridgeview-device": DEVICE }, ...opts });

  it("is off without the admin page or R2", async () => {
    expect((await share((await setup({ password: "" })).api)).status).toBe(503);
    vesselDetails.close();
    photoSubmissions.close();
    expect((await share((await setup({ r2: false })).api)).status).toBe(503);
  });

  it("queues a photo, without its metadata, until it's approved", async () => {
    const { api, token } = await setup();
    expect((await call(api, "POST", "/api/ships/316000001/photos", { body: Buffer.from("nope") })).status).toBe(415);
    expect((await call(api, "POST", "/api/ships/999/photos", { body: EXIF_JPEG })).status).toBe(404);

    const res = await share(api);
    expect(res.status).toBe(202);
    expect(vesselDetails.vesselInfo(316000001)).toBeUndefined();

    expect((await call(api, "GET", "/api/admin/submissions")).status).toBe(401);
    const { body } = await call(api, "GET", "/api/admin/submissions", { token });
    const [submission] = body.submissions;
    expect(submission).toMatchObject({ mmsi: 316000001, shipName: "LAKER", artist: "Jo Doe", note: "From the park" });
    expect(submission).not.toHaveProperty("deviceId");
    expect(submission).not.toHaveProperty("ipHash");

    expect(submission.url).toMatch(/^https:\/\/photos\.example\/shared\//);
    const stored = store.files.get(submission.url);
    expect(stored.includes(Buffer.from("GPS"))).toBe(false);
    expect(stored.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(submission).toMatchObject({ width: 2048, height: 1536 });
    expect(submission).not.toHaveProperty("sha256");

    const approved = await call(api, "POST", `/api/admin/submissions/${submission.id}/approve`, { token });
    expect(approved.status).toBe(200);
    expect(approved.body.overrides.addedPhotos).toEqual([
      { url: submission.url, artist: "Jo Doe", license: "Used with permission", year: new Date().getUTCFullYear() },
    ]);
    expect(vesselDetails.vesselInfo(316000001).imageUrl).toBe(submission.url);
    expect((await call(api, "GET", "/api/admin/submissions", { token })).body.submissions).toEqual([]);
  });

  it("refuses photos that aren't whole JPEGs or are an odd size, and cuts off anything after the picture", async () => {
    const { api } = await setup();
    const send = (body) => call(api, "POST", "/api/ships/316000001/photos", { body });
    expect((await send(EXIF_JPEG.subarray(0, -2))).status).toBe(415);
    expect((await send(jpeg({ width: 600, height: 400 }))).status).toBe(422);
    expect((await send(jpeg({ width: 9000, height: 3000 }))).status).toBe(422);
    expect((await send(jpeg({ width: 4000, height: 800 }))).status).toBe(422);

    const res = await send(jpeg({ after: [...Buffer.from("PK\x03\x04 hidden zip")] }));
    expect(res.status).toBe(202);
    const [stored] = store.files.values();
    expect(stored.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(stored.includes(Buffer.from("hidden"))).toBe(false);
  });

  it("refuses a photo sent before, whether waiting, approved or rejected", async () => {
    const { api, token } = await setup();
    expect((await share(api)).status).toBe(202);
    expect((await share(api)).status).toBe(409);

    const [first] = (await call(api, "GET", "/api/admin/submissions", { token })).body.submissions;
    await call(api, "POST", `/api/admin/submissions/${first.id}/approve`, { token });
    expect((await share(api)).status).toBe(409);

    const other = jpeg({ data: [4, 5, 6] });
    expect((await share(api, { body: other })).status).toBe(202);
    const [second] = (await call(api, "GET", "/api/admin/submissions", { token })).body.submissions;
    await call(api, "DELETE", `/api/admin/submissions/${second.id}`, { token });
    expect((await share(api, { body: other })).status).toBe(422);
  });

  it("deletes a rejected photo", async () => {
    const { api, token } = await setup();
    await share(api);
    const [submission] = (await call(api, "GET", "/api/admin/submissions", { token })).body.submissions;
    expect((await call(api, "DELETE", `/api/admin/submissions/${submission.id}`, { token })).status).toBe(204);
    expect(store.remove).toHaveBeenCalledWith(submission.url);
    expect(store.files.size).toBe(0);
    expect(vesselDetails.overrides(316000001)).toEqual({});
  });

  it("bans a sender, rejecting everything they've sent, until the ban is lifted", async () => {
    const { api, token } = await setup();
    const photo = (n) => jpeg({ data: [n] });
    await share(api, { body: photo(1) });
    await share(api, { body: photo(2), ip: "5.6.7.8" });
    const { submissions } = (await call(api, "GET", "/api/admin/submissions", { token })).body;
    const res = await call(api, "POST", `/api/admin/submissions/${submissions[0].id}/ban`, { token, body: { reason: "Spam" } });
    expect(res.body.rejected).toHaveLength(2);
    expect((await call(api, "GET", "/api/admin/submissions", { token })).body.submissions).toEqual([]);

    expect((await share(api, { body: photo(3), ip: "9.9.9.9" })).status).toBe(403);
    expect((await share(api, { body: photo(3), headers: {} })).status).toBe(403);
    expect((await share(api, { body: photo(3), headers: {}, ip: "9.9.9.9" })).status).toBe(202);

    const { bans } = (await call(api, "GET", "/api/admin/submissions/bans", { token })).body;
    expect(bans).toMatchObject([{ reason: "Spam", device: true }]);
    expect((await call(api, "DELETE", `/api/admin/submissions/bans/${bans[0].id}`, { token })).status).toBe(204);
    expect((await share(api, { body: photo(4) })).status).toBe(202);
    // Photos rejected with the ban can't be sent again
    expect((await share(api, { body: photo(1) })).status).toBe(422);
  });

  it("limits how often one IP address shares", async () => {
    const { api } = await setup();
    for (let i = 0; i < 10; i++) await share(api, { headers: {} });
    expect((await share(api, { headers: {} })).status).toBe(429);
  });
});

describe("photos reported from the app", () => {
  const DEVICE = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const COMMONS = "https://upload.wikimedia.org/a.jpg";
  const ADDED = "/api/photos/" + "a".repeat(32) + ".jpg";
  let vesselDetails;
  let photoReports;
  let dir;

  afterEach(() => {
    vesselDetails?.close();
    photoReports?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function setup({ password = PASSWORD } = {}) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-report-"));
    // The Commons photo comes from the lookup; the other was added here
    vi.useFakeTimers();
    try {
      vesselDetails = createVesselDetails({ fetchInfo: async () => ({ photos: [{ url: COMMONS }] }) });
      vesselDetails.handleMessage(staticData(316000001, "LAKER"));
      await vi.advanceTimersByTimeAsync(2000);
    } finally {
      vi.useRealTimers();
    }
    vesselDetails.setOverrides(316000001, { addedPhotos: [{ url: ADDED }] });
    photoReports = createPhotoReports();
    const api = createAdminApi({ password, vesselDetails, photosDir: path.join(dir, "photos"), photoReports });
    const token = password ? (await call(api, "POST", "/api/admin/login", { body: { password } })).body.token : undefined;
    return { api, token };
  }

  const report = (api, body, opts = {}) =>
    call(api, "POST", "/api/ships/316000001/photos/report", { body, headers: { "x-bridgeview-device": DEVICE }, ...opts });

  it("is off without the admin page", async () => {
    const { api } = await setup({ password: "" });
    expect((await report(api, { url: COMMONS, reason: "offensive" })).status).toBe(503);
  });

  it("takes reports of the ship's own photos, once per reporter", async () => {
    const { api, token } = await setup();
    expect((await report(api, { url: COMMONS, reason: "rude" })).status).toBe(400);
    expect((await report(api, { url: "https://elsewhere.example/b.jpg", reason: "offensive" })).status).toBe(404);

    expect((await report(api, { url: COMMONS, reason: "wrong-ship", details: "It's the Algoma " })).status).toBe(202);
    expect((await report(api, { url: COMMONS, reason: "offensive" })).status).toBe(202);
    // The app has uploaded photos as whole URLs
    expect((await report(api, { url: `https://bridgeview.example${ADDED}`, reason: "privacy" }, { headers: {} })).status).toBe(202);

    expect((await call(api, "GET", "/api/admin/reports")).status).toBe(401);
    const { photos } = (await call(api, "GET", "/api/admin/reports", { token })).body;
    expect(photos).toMatchObject([
      { url: COMMONS, mmsi: 316000001, shipName: "LAKER", reports: [{ reason: "wrong-ship", details: "It's the Algoma" }] },
      { url: ADDED, reports: [{ reason: "privacy" }] },
    ]);
    expect(photos[0].reports).toHaveLength(1);
  });

  it("hides a reported photo, or removes it if it was added here", async () => {
    const { api, token } = await setup();
    await report(api, { url: COMMONS, reason: "offensive" });
    await report(api, { url: ADDED, reason: "offensive" });

    const hidden = await call(api, "POST", "/api/admin/reports/hide", { token, body: { url: COMMONS } });
    expect(hidden.body.overrides).toEqual({ addedPhotos: [{ url: ADDED }], hiddenPhotos: [COMMONS] });
    const removed = await call(api, "POST", "/api/admin/reports/hide", { token, body: { url: ADDED } });
    expect(removed.body.overrides).toEqual({ hiddenPhotos: [COMMONS] });
    expect(vesselDetails.vesselInfo(316000001).photos).toBeUndefined();
    expect((await call(api, "GET", "/api/admin/reports", { token })).body.photos).toEqual([]);
  });

  it("dismisses reports", async () => {
    const { api, token } = await setup();
    await report(api, { url: COMMONS, reason: "other" });
    expect((await call(api, "POST", "/api/admin/reports/dismiss", { token, body: { url: COMMONS } })).status).toBe(204);
    expect((await call(api, "POST", "/api/admin/reports/dismiss", { token, body: { url: COMMONS } })).status).toBe(404);
    expect(vesselDetails.vesselInfo(316000001).photos).toHaveLength(2);
  });
});

describe("createAdminApi with another photo store", () => {
  let vesselDetails;
  afterEach(() => vesselDetails?.close());

  function fakeStore({ fail = false } = {}) {
    const saved = new Set();
    return {
      saved,
      async save(bytes, type) {
        if (fail) throw new Error("R2 PUT failed: 403 AccessDenied");
        const url = `https://photos.example/ships/${"b".repeat(31)}${saved.size}.${type}`;
        saved.add(url);
        return url;
      },
      owns: (url) => url.startsWith("https://photos.example/ships/"),
      remove: vi.fn(async (url) => saved.delete(url)),
    };
  }

  async function setupWith(photoStore) {
    vesselDetails = createVesselDetails();
    vesselDetails.handleMessage(staticData(316000001, "LAKER"));
    const api = createAdminApi({ password: PASSWORD, vesselDetails, photosDir: "/nonexistent", photoStore });
    const { body } = await call(api, "POST", "/api/admin/login", { body: { password: PASSWORD } });
    return { api, token: body.token };
  }

  it("uploads there and deletes from there", async () => {
    const store = fakeStore();
    const { api, token } = await setupWith(store);
    const res = await call(api, "POST", "/api/admin/ships/316000001/photos", { token, body: JPEG });
    expect(res.status).toBe(201);
    const url = res.body.overrides.addedPhotos[0].url;
    expect(store.saved.has(url)).toBe(true);
    expect(res.body.info.imageUrl).toBe(url);

    await call(api, "PUT", "/api/admin/ships/316000001/overrides", { token, body: { addedPhotos: [] } });
    expect(store.remove).toHaveBeenCalledWith(url);
  });

  it("leaves photos added by link alone when they're removed", async () => {
    const store = fakeStore();
    const { api, token } = await setupWith(store);
    await call(api, "PUT", "/api/admin/ships/316000001/overrides", { token, body: { addedPhotos: [{ url: "https://elsewhere.example/a.jpg" }] } });
    await call(api, "PUT", "/api/admin/ships/316000001/overrides", { token, body: { addedPhotos: [] } });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("says when the store fails, saving nothing", async () => {
    const { api, token } = await setupWith(fakeStore({ fail: true }));
    const res = await call(api, "POST", "/api/admin/ships/316000001/photos", { token, body: JPEG });
    expect(res.status).toBe(502);
    expect(vesselDetails.overrides(316000001)).toEqual({});
  });
});
