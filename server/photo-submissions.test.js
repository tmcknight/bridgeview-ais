import { describe, it, expect, afterEach } from "vitest";
import { createPhotoSubmissions, IP_BAN_MS, MAX_PENDING_PER_SHIP, parseSubmission } from "./photo-submissions.js";

const DEVICE = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_DEVICE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("parseSubmission", () => {
  it("tidies the name and note and lowercases the device ID", () => {
    const params = new URLSearchParams({ artist: " Jo  Doe ", note: "  From the\n park  " });
    expect(parseSubmission(params, DEVICE.toUpperCase()).submission).toEqual({ artist: "Jo Doe", note: "From the park", deviceId: DEVICE });
    expect(parseSubmission(new URLSearchParams(), undefined).submission).toEqual({ artist: undefined, note: undefined, deviceId: undefined });
  });

  it("rejects long notes and odd device IDs", () => {
    expect(parseSubmission(new URLSearchParams({ note: "x".repeat(501) })).error).toMatch(/note/);
    expect(parseSubmission(new URLSearchParams({ artist: "x".repeat(81) })).error).toMatch(/artist/);
    expect(parseSubmission(new URLSearchParams(), "not-a-uuid").error).toMatch(/device/);
  });
});

describe("createPhotoSubmissions", () => {
  let submissions;
  let clock;
  afterEach(() => submissions?.close());

  function setup() {
    clock = Date.parse("2026-10-31T12:00:00Z");
    submissions = createPhotoSubmissions({ now: () => new Date(clock) });
    return submissions;
  }

  it("keeps photos until they're removed, oldest first", () => {
    const s = setup();
    const a = s.add({ mmsi: 316000001, url: "/api/photos/a.jpg", artist: "Jo", note: "Nice", deviceId: DEVICE, ip: "1.2.3.4" });
    const b = s.add({ mmsi: 316000002, url: "/api/photos/b.jpg", ip: "1.2.3.4" });
    expect(s.pending().map((p) => p.id)).toEqual([a, b]);
    expect(s.get(a)).toMatchObject({ mmsi: 316000001, artist: "Jo", note: "Nice", deviceId: DEVICE, createdAt: "2026-10-31T12:00:00.000Z" });
    expect(s.get(a).ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(s.get(a).ipHash).not.toContain("1.2.3.4");
    s.remove(a);
    expect(s.pending().map((p) => p.id)).toEqual([b]);
  });

  it("has room for a limited number per ship", () => {
    const s = setup();
    for (let i = 0; i < MAX_PENDING_PER_SHIP; i++) s.add({ mmsi: 316000001, url: `/u${i}`, ip: "1.2.3.4" });
    expect(s.hasRoom(316000001)).toBe(false);
    expect(s.hasRoom(316000002)).toBe(true);
  });

  it("bans a sender's device for good and IP address for a while", () => {
    const s = setup();
    const id = s.add({ mmsi: 316000001, url: "/a", deviceId: DEVICE, ip: "1.2.3.4" });
    s.add({ mmsi: 316000002, url: "/b", deviceId: DEVICE, ip: "9.9.9.9" });
    const unrelated = s.add({ mmsi: 316000002, url: "/c", deviceId: OTHER_DEVICE, ip: "8.8.8.8" });

    const rejected = s.ban(s.get(id), "Not a ship");
    expect(rejected.map((p) => p.url).sort()).toEqual(["/a", "/b"]);
    expect(s.get(unrelated)).toBeDefined();

    expect(s.isBanned({ deviceId: DEVICE, ip: "5.5.5.5" })).toBe(true);
    expect(s.isBanned({ deviceId: OTHER_DEVICE, ip: "1.2.3.4" })).toBe(true);
    expect(s.isBanned({ deviceId: OTHER_DEVICE, ip: "8.8.8.8" })).toBe(false);

    clock += IP_BAN_MS + 1;
    expect(s.isBanned({ deviceId: OTHER_DEVICE, ip: "1.2.3.4" })).toBe(false);
    expect(s.isBanned({ deviceId: DEVICE, ip: "5.5.5.5" })).toBe(true);

    const [ban] = s.bans();
    expect(ban).toEqual({ id: ban.id, reason: "Not a ship", device: true, createdAt: "2026-10-31T12:00:00.000Z" });
    expect(s.unban(ban.id)).toBe(true);
    expect(s.unban(ban.id)).toBe(false);
    expect(s.isBanned({ deviceId: DEVICE, ip: "5.5.5.5" })).toBe(false);
  });
});
