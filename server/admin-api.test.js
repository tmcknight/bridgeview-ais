import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createAdminApi, LOGIN_LIMITS, SESSION_MS } from "./admin-api.js";
import { createVesselDetails } from "./vessel-details.js";

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
function call(api, method, url, { body, token, ip = "1.2.3.4" } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, destroy() {} });
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
