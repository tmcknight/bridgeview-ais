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

    function create(fetchInfo, file) {
      vi.useFakeTimers();
      clock = Date.UTC(2026, 9, 27);
      details = createVesselDetails({ file, now, fetchInfo, lookupIntervalMs: 1 });
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
      expect(fetchInfo).toHaveBeenCalledWith(316000001, undefined);
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
      expect(fetchInfo).toHaveBeenLastCalledWith(316000001, 9600000);
      expect(details.vesselInfo(316000001)).toEqual(INFO);
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
