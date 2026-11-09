import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  BRIDGE_CENTER,
  createShipLog,
  detectBridgePassage,
  loadShipLogFile,
  MAX_SHIP_LOG_ENTRIES,
  reportTime,
} from "./ship-log.js";

const north = (nm) => BRIDGE_CENTER.lat + nm / 60;
const at = (lat) => ({ latitude: lat, longitude: BRIDGE_CENTER.lng });

function position(mmsi, lat, name = "LAKER") {
  return {
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: BRIDGE_CENTER.lng },
    Message: { PositionReport: {} },
  };
}

function staticData(mmsi, name) {
  return {
    MessageType: "ShipStaticData",
    MetaData: { MMSI: mmsi, ShipName: "", latitude: 0, longitude: 0 },
    Message: { ShipStaticData: { Name: name } },
  };
}

describe("detectBridgePassage", () => {
  it("detects northbound crossings as upbound and southbound as downbound", () => {
    expect(detectBridgePassage(at(north(-0.2)), at(north(0.1)))).toBe("upbound");
    expect(detectBridgePassage(at(north(0.1)), at(north(-0.1)))).toBe("downbound");
  });

  it("ignores ships staying on one side, far crossings and first sightings", () => {
    expect(detectBridgePassage(at(north(0.3)), at(north(0.1)))).toBeNull();
    expect(
      detectBridgePassage(
        { latitude: north(-0.1), longitude: BRIDGE_CENTER.lng + 1 },
        { latitude: north(0.1), longitude: BRIDGE_CENTER.lng + 1 }
      )
    ).toBeNull();
    expect(detectBridgePassage(undefined, at(north(0.1)))).toBeNull();
  });
});

describe("createShipLog", () => {
  let t;
  let log;
  const now = () => t;

  beforeEach(() => {
    t = Date.UTC(2026, 9, 26, 12);
    log = createShipLog({ now });
  });

  it("logs a ship passing under the bridge and emits the entry", () => {
    const onEntry = vi.fn();
    log.on("entry", onEntry);

    log.handleMessage(position(1, north(-0.2)));
    expect(log.entries()).toEqual([]);
    t += 60_000;
    log.handleMessage(position(1, north(0.1)));

    // Crossed two thirds of the way between the reports
    const crossed = new Date(t - 20_000).toISOString();
    const entry = { mmsi: 1, name: "LAKER", passages: [{ time: crossed, direction: "upbound" }], lastSeen: new Date(t).toISOString() };
    expect(log.entries()).toEqual([entry]);
    expect(onEntry).toHaveBeenCalledWith(entry);
  });

  it("dates a passage by the reports' own times, not when they arrived", () => {
    const reportedAt = (msg, time) => ({ ...msg, MetaData: { ...msg.MetaData, time_utc: new Date(time).toISOString() } });
    const start = t;
    // Ship 1 passes first, seen only by a feed that delivers its reports 5 minutes late
    // Ship 2 passes a minute after, seen live
    t = start + 6 * 60_000;
    log.handleMessage(reportedAt(position(1, north(-0.1)), start));
    log.handleMessage(reportedAt(position(2, north(-0.1)), start + 60_000));
    t = start + 7 * 60_000;
    log.handleMessage(reportedAt(position(1, north(0.1)), start + 2 * 60_000));
    log.handleMessage(reportedAt(position(2, north(0.1)), start + 3 * 60_000));

    const passed = (mmsi) => log.entries().find((e) => e.mmsi === mmsi).passages[0].time;
    expect(passed(1)).toBe(new Date(start + 60_000).toISOString());
    expect(passed(2)).toBe(new Date(start + 2 * 60_000).toISOString());
    expect(log.entries().find((e) => e.mmsi === 1).lastSeen).toBe(new Date(start + 2 * 60_000).toISOString());
  });

  it("reads AISStream's time format", () => {
    expect(reportTime("2026-10-26 12:00:30.123456789 +0000 UTC")).toBe(Date.UTC(2026, 9, 26, 12, 0, 30, 123));
    expect(reportTime("2026-10-26T12:00:30.000Z")).toBe(Date.UTC(2026, 9, 26, 12, 0, 30));
    expect(reportTime("nonsense")).toBeUndefined();
    expect(reportTime(undefined)).toBeUndefined();
  });

  it("ignores a report older than one already handled", () => {
    const reportedAt = (msg, time) => ({ ...msg, MetaData: { ...msg.MetaData, time_utc: new Date(time).toISOString() } });
    const start = t;
    t += 2 * 60_000;
    log.handleMessage(reportedAt(position(1, north(0.1)), start + 60_000));
    // A slower feed's older report from before the ship got here
    log.handleMessage(reportedAt(position(1, north(-0.1)), start));
    log.handleMessage(reportedAt(position(1, north(0.2)), start + 2 * 60_000));
    expect(log.entries()).toEqual([]);
  });

  it("never dates a report later than now", () => {
    log.handleMessage({ ...position(1, north(-0.1)), MetaData: { ...position(1, north(-0.1)).MetaData, time_utc: "2099-01-01T00:00:00Z" } });
    t += 60_000;
    log.handleMessage(position(1, north(0.1)));
    expect(log.entries()[0].passages[0].time).toBe(new Date(t - 30_000).toISOString());
  });

  it("leaves Class B craft out of the log", () => {
    const classB = (msg) => ({ ...msg, MetaData: { ...msg.MetaData, AisClass: "B" } });
    log.handleMessage(classB(position(1, north(-0.2), "SEA BREEZE")));
    t += 60_000;
    log.handleMessage(classB(position(1, north(0.1), "SEA BREEZE")));
    expect(log.entries()).toEqual([]);
  });

  it("ignores jitter back and forth across the bridge line", () => {
    log.handleMessage(position(1, north(-0.2)));
    log.handleMessage(position(1, north(0.1)));
    t += 60_000;
    log.handleMessage(position(1, north(-0.01)));
    log.handleMessage(position(1, north(0.01)));
    expect(log.entries()[0].passages.map((p) => p.direction)).toEqual(["upbound"]);

    t += 6 * 60 * 60_000;
    log.handleMessage(position(1, north(0.2)));
    log.handleMessage(position(1, north(-0.1)));
    expect(log.entries()[0].passages.map((p) => p.direction)).toEqual(["downbound", "upbound"]);
  });

  it("keeps last seen current for logged ships only, in one-minute steps", () => {
    log.handleMessage(position(1, north(-0.2)));
    log.handleMessage(position(1, north(0.1)));
    log.handleMessage(position(2, north(5)));
    const onEntry = vi.fn();
    log.on("entry", onEntry);

    t += 30_000;
    log.handleMessage(position(1, north(0.5)));
    expect(onEntry).not.toHaveBeenCalled();

    t += 60_000;
    log.handleMessage(position(1, north(1)));
    expect(log.entries().map((e) => e.mmsi)).toEqual([1]);
    expect(log.entries()[0].lastSeen).toBe(new Date(t).toISOString());
  });

  it("picks up names from static data", () => {
    log.handleMessage(position(1, north(-0.2), ""));
    log.handleMessage(position(1, north(0.1), ""));
    expect(log.entries()[0].name).toBe("MMSI 1");
    log.handleMessage(staticData(1, "REAL NAME"));
    expect(log.entries()[0].name).toBe("REAL NAME");
  });

  it("drops the least recently seen ship beyond the limit", () => {
    for (let i = 0; i <= MAX_SHIP_LOG_ENTRIES; i++) {
      t += 1000;
      log.handleMessage(position(i, north(-0.2)));
      log.handleMessage(position(i, north(0.1)));
    }
    expect(log.entries()).toHaveLength(MAX_SHIP_LOG_ENTRIES);
    expect(log.entries().some((e) => e.mmsi === 0)).toBe(false);
  });
});

describe("saving and loading", () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-log-"));
    file = path.join(dir, "nested", "ship-log.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("saves to disk and loads it back on restart", () => {
    const log = createShipLog({ file, saveDelayMs: 60_000 });
    log.handleMessage(position(1, north(-0.2)));
    log.handleMessage(position(1, north(0.1)));
    log.flush();

    expect(createShipLog({ file }).entries()).toEqual(log.entries());
  });

  it("starts empty when the file is missing or corrupt", () => {
    const logger = { warn: vi.fn() };
    expect(loadShipLogFile(file, logger).size).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(loadShipLogFile(file, logger).size).toBe(0);
    expect(logger.warn).toHaveBeenCalled();

    fs.writeFileSync(file, JSON.stringify([{ mmsi: 1 }, { mmsi: 2, name: "X", lastSeen: "", passages: [] }]));
    expect(loadShipLogFile(file, logger).size).toBe(0);
  });
});
