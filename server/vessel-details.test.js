import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createVesselDetails, INFO_FAILURE_RETRY_MS, INFO_MISS_RETRY_MS } from "./vessel-details.js";

function position(mmsi, name = "") {
  return {
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, ShipName: name, latitude: 43, longitude: -82.4 },
    Message: { PositionReport: {} },
  };
}

function staticData(mmsi, name, destination = "SARNIA") {
  return {
    MessageType: "ShipStaticData",
    MetaData: { MMSI: mmsi, ShipName: name, latitude: 0, longitude: 0, Source: "local" },
    Message: {
      ShipStaticData: {
        Name: name,
        Destination: destination,
        CallSign: "VCXY",
        ImoNumber: 9600000,
        Type: 70,
        Dimension: { A: 150, B: 75, C: 12, D: 12 },
        Draught: 8.1,
      },
    },
  };
}

describe("createVesselDetails", () => {
  let details;
  let dir;

  afterEach(() => {
    details?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("returns each ship's latest details message", () => {
    details = createVesselDetails();
    details.handleMessage(staticData(1, "LAKER", "SARNIA"));
    details.handleMessage(staticData(1, "LAKER", "DULUTH"));

    expect(details.detailsMessage(1).Message.ShipStaticData.Destination).toBe("DULUTH");
    expect(details.detailsMessage(2)).toBeUndefined();
  });

  it("learns names from details and from AISStream position reports", () => {
    details = createVesselDetails();
    details.handleMessage(staticData(1, "LAKER  "));
    details.handleMessage(position(2, "FERRY"));
    details.handleMessage(position(2, ""));

    expect(details.name(1)).toBe("LAKER");
    expect(details.name(2)).toBe("FERRY");
    expect(details.name(3)).toBeUndefined();
    // A name alone isn't details
    expect(details.detailsMessage(2)).toBeUndefined();
  });

  it("keeps a known name when details arrive with a blank one", () => {
    details = createVesselDetails();
    details.handleMessage(position(1, "LAKER"));
    details.handleMessage(staticData(1, ""));
    expect(details.name(1)).toBe("LAKER");
  });

  it("keeps details across restarts in the database file", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vessels-"));
    const file = path.join(dir, "nested", "bridgeview.db");
    details = createVesselDetails({ file });
    details.handleMessage(staticData(1, "LAKER", "DULUTH"));
    details.handleMessage(position(2, "FERRY"));
    details.close();

    details = createVesselDetails({ file });
    expect(details.name(1)).toBe("LAKER");
    expect(details.name(2)).toBe("FERRY");
    expect(details.detailsMessage(1).Message.ShipStaticData.Destination).toBe("DULUTH");
  });

  describe("Wikidata lookups", () => {
    const INFO = { wikidataId: "Q1", wikidataUrl: "https://www.wikidata.org/wiki/Q1", imageUrl: "https://x/ship.jpg" };
    let clock;
    const now = () => new Date(clock);
    const flush = () => vi.advanceTimersByTimeAsync(10);

    function create(fetchInfo, file, registry = null) {
      vi.useFakeTimers();
      clock = Date.UTC(2026, 9, 27);
      details = createVesselDetails({ file, now, fetchInfo, registry, lookupIntervalMs: 1 });
      return details;
    }

    afterEach(() => vi.useRealTimers());

    it("looks a ship up once, stores the photo link, and emits it", async () => {
      const fetchInfo = vi.fn().mockResolvedValue(INFO);
      create(fetchInfo);
      const onInfo = vi.fn();
      details.on("info", onInfo);

      expect(details.vesselInfo(316000001)).toBeUndefined();
      details.handleMessage(position(316000001, "LAKER"));
      details.handleMessage(position(316000001, "LAKER"));
      await flush();

      expect(fetchInfo).toHaveBeenCalledTimes(1);
      expect(fetchInfo).toHaveBeenCalledWith(316000001, { imo: undefined, callSign: undefined, name: "LAKER" });
      expect(onInfo).toHaveBeenCalledWith(316000001, INFO);
      expect(details.vesselInfo(316000001)).toEqual(INFO);

      details.handleMessage(position(316000001, "LAKER"));
      await flush();
      expect(fetchInfo).toHaveBeenCalledTimes(1);
    });

    it("looks the ship up again once its IMO number is known", async () => {
      const fetchInfo = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(INFO);
      create(fetchInfo);
      details.handleMessage(position(316000001));
      await flush();
      expect(details.vesselInfo(316000001)).toBeNull();

      details.handleMessage(staticData(316000001, "LAKER"));
      await flush();
      expect(fetchInfo).toHaveBeenLastCalledWith(316000001, { imo: 9600000, callSign: "VCXY", name: "LAKER" });
      expect(details.vesselInfo(316000001)).toEqual(INFO);
    });

    it("fills in Wikidata's gaps from the ship's register record", async () => {
      const record = { source: "transport-canada", yearBuilt: 2012, grossTonnage: 24451 };
      const registry = { lookup: (imo) => (imo === 9600000 ? record : undefined) };
      create(vi.fn().mockResolvedValue(INFO), undefined, registry);
      const onInfo = vi.fn();
      details.on("info", onInfo);
      details.handleMessage(staticData(316000001, "LAKER"));
      await flush();

      const merged = { ...INFO, yearBuilt: 2012, grossTonnage: 24451, registry: record };
      expect(onInfo).toHaveBeenCalledWith(316000001, merged);
      expect(details.vesselInfo(316000001)).toEqual(merged);
    });

    it("retries misses after a week and failures after a few minutes", async () => {
      const fetchInfo = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue(null);
      create(fetchInfo);
      details.handleMessage(position(316000001));
      await flush();
      expect(details.vesselInfo(316000001)).toBeUndefined();

      details.handleMessage(position(316000001));
      await flush();
      expect(fetchInfo).toHaveBeenCalledTimes(1);

      clock += INFO_FAILURE_RETRY_MS + 1;
      details.handleMessage(position(316000001));
      await flush();
      expect(fetchInfo).toHaveBeenCalledTimes(2);
      expect(details.vesselInfo(316000001)).toBeNull();

      clock += INFO_MISS_RETRY_MS + 1;
      details.handleMessage(position(316000001));
      await flush();
      expect(fetchInfo).toHaveBeenCalledTimes(3);
    });

    it("keeps lookups across restarts, so they aren't repeated", async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "vessels-"));
      const file = path.join(dir, "bridgeview.db");
      const fetchInfo = vi.fn().mockResolvedValue(INFO);
      create(fetchInfo, file);
      details.handleMessage(position(316000001));
      await flush();
      details.close();

      details = createVesselDetails({ file, now, fetchInfo, lookupIntervalMs: 1 });
      details.handleMessage(position(316000001));
      await flush();
      expect(fetchInfo).toHaveBeenCalledTimes(1);
      expect(details.vesselInfo(316000001)).toEqual(INFO);
    });

    it("skips lookups without a fetchInfo function or a valid MMSI or IMO", async () => {
      const fetchInfo = vi.fn().mockResolvedValue(INFO);
      create(fetchInfo);
      details.handleMessage(position(12345));
      await flush();
      expect(fetchInfo).not.toHaveBeenCalled();
    });
  });

  it("adds new columns to a database created by an older version", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vessels-"));
    const file = path.join(dir, "bridgeview.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE vessels (mmsi INTEGER PRIMARY KEY, name TEXT, call_sign TEXT, imo INTEGER,
      ship_type INTEGER, destination TEXT, length INTEGER, width INTEGER, draught REAL,
      details_message TEXT, details_source TEXT, details_updated_at TEXT,
      first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    old.exec("INSERT INTO vessels (mmsi, name, first_seen_at, updated_at) VALUES (1, 'LAKER', 'x', 'x')");
    old.close();

    details = createVesselDetails({ file });
    expect(details.name(1)).toBe("LAKER");
    expect(details.vesselInfo(1)).toBeUndefined();
  });
});

describe("admin corrections", () => {
  let details;
  afterEach(() => {
    details?.close();
    vi.useRealTimers();
  });

  it("applies corrections over lookups, keeps them through the next lookup, and emits them", async () => {
    vi.useFakeTimers();
    const fetchInfo = vi.fn().mockResolvedValue({ operator: "Old", builder: "Yard" });
    details = createVesselDetails({ fetchInfo, lookupIntervalMs: 1 });
    details.handleMessage(staticData(316000001, "LAKER"));
    await vi.advanceTimersByTimeAsync(10);

    const onInfo = vi.fn();
    details.on("info", onInfo);
    details.setOverrides(316000001, { fields: { operator: "New" } });
    expect(onInfo).toHaveBeenLastCalledWith(316000001, { operator: "New", builder: "Yard" });
    expect(details.vesselInfo(316000001)).toEqual({ operator: "New", builder: "Yard" });

    fetchInfo.mockResolvedValue({ operator: "Old", builder: "Other yard" });
    expect(details.refresh(316000001)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    expect(onInfo).toHaveBeenLastCalledWith(316000001, { operator: "New", builder: "Other yard" });

    const view = details.adminView(316000001);
    expect(view.lookedUp).toEqual({ operator: "Old", builder: "Other yard" });
    expect(view.overrides).toEqual({ fields: { operator: "New" } });
    expect(view.record.name).toBe("LAKER");

    details.setOverrides(316000001, {});
    expect(details.vesselInfo(316000001).operator).toBe("Old");
    expect(details.overrides(316000001)).toEqual({});
  });

  it("gives corrections to ships not looked up yet", () => {
    details = createVesselDetails();
    details.handleMessage(position(2, "FERRY"));
    expect(details.vesselInfo(2)).toBeUndefined();
    details.setOverrides(2, { fields: { operator: "Ferry Co" } });
    expect(details.vesselInfo(2)).toEqual({ operator: "Ferry Co" });
  });

  it("can't refresh with lookups off", () => {
    details = createVesselDetails();
    expect(details.refresh(1)).toBe(false);
  });

  it("finds ships by name, MMSI, IMO number and call sign", () => {
    details = createVesselDetails();
    details.handleMessage(staticData(316000001, "ALGOMA 100%"));
    details.handleMessage(position(366000002, "FERRY"));
    details.setOverrides(366000002, { fields: { name: "Ferry" } });

    expect(details.search({ query: "algoma" }).map((s) => s.mmsi)).toEqual([316000001]);
    expect(details.search({ query: "3660" }).map((s) => s.mmsi)).toEqual([366000002]);
    expect(details.search({ query: "96000" }).map((s) => s.mmsi)).toEqual([316000001]);
    expect(details.search({ query: "vcxy" }).map((s) => s.mmsi)).toEqual([316000001]);
    expect(details.search({ query: "100%" }).map((s) => s.mmsi)).toEqual([316000001]);
    expect(details.search({ query: "_" })).toEqual([]);
    expect(details.search({ overriddenOnly: true }).map((s) => s.mmsi)).toEqual([366000002]);
    expect(details.search()).toHaveLength(2);
  });
});
