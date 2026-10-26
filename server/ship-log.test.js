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

    const entry = { mmsi: 1, name: "LAKER", passages: [{ time: new Date(t).toISOString(), direction: "upbound" }], lastSeen: new Date(t).toISOString() };
    expect(log.entries()).toEqual([entry]);
    expect(onEntry).toHaveBeenCalledWith(entry);
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
