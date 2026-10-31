import zlib from "node:zlib";
import { describe, it, expect, vi } from "vitest";
import {
  createVesselRegistry,
  parseRegistryRows,
  readXlsxRows,
  unzip,
} from "./vessel-registry.js";

// A ZIP archive of the given files, deflated like a real XLSX
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = zlib.deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const HEADER = [
  "Official Number",
  "Vessel Name",
  "IMO Vessel Number",
  "Hull Number",
  "Year of Build",
  "Port of Registry",
  "Gross Tonnage",
  "Length",
  "Engine Propulsion Power",
  "Unit/Brake Power",
];

// An XLSX like Transport Canada's: text in shared strings, numbers inline
function registerXlsx(rows) {
  const shared = [];
  const cell = (value, ref) => {
    if (typeof value === "number") return `<c r="${ref}" t="n"><v>${value}</v></c>`;
    if (value === "") return `<c r="${ref}"/>`;
    shared.push(value);
    return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
  };
  const sheetRows = [HEADER, ...rows]
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, String.fromCharCode(65 + c) + (r + 1))).join("")}</row>`)
    .join("");
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return zip({
    "xl/sharedStrings.xml": `<sst>${shared.map((s) => `<si><t>${escape(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

const EQUINOX = [837491.0, "ALGOMA EQUINOX", "9613927", "MD-149-GB-01", "201204", "ST. CATHARINES", 24451.0, 222.48, 6929.0, "KILOWATTS"];

describe("readXlsxRows", () => {
  it("reads shared strings, numbers, blanks and escaped text", () => {
    const rows = readXlsxRows(registerXlsx([[1.0, "A & B", "", "", "2001", "", 5.5, "", "", ""]]));
    expect(rows[0]).toEqual(HEADER);
    expect(rows[1]).toEqual(["1", "A & B", "", "", "2001", "", "5.5", "", "", ""]);
  });

  it("rejects files that aren't ZIP archives", () => {
    expect(() => unzip(Buffer.from("not a zip at all, just some text"))).toThrow("not a ZIP file");
  });
});

describe("parseRegistryRows", () => {
  it("keys ships by IMO number and tidies the register's values", () => {
    const records = parseRegistryRows(readXlsxRows(registerXlsx([EQUINOX])));
    expect(records.get(9613927)).toEqual({
      source: "transport-canada",
      officialNumber: "837491",
      name: "ALGOMA EQUINOX",
      hullNumber: "MD-149-GB-01",
      yearBuilt: 2012,
      portOfRegistry: "ST. CATHARINES",
      grossTonnage: 24451,
      length: 222.48,
      enginePowerKw: 6929,
    });
  });

  it("leaves out ships without a valid IMO number and keeps the first row for an IMO", () => {
    const rows = [
      [1.0, "NO IMO", "", "", "1990", "", 10.0, 9.0, "", ""],
      [2.0, "BAD IMO", "946245", "", "1990", "", 10.0, 9.0, "", ""],
      [3.0, "FIRST", "9896531", "", "2019", "", 1818.0, 30.0, "", ""],
      [3.0, "SECOND", "9896531", "", "2019", "", 14.8, 30.0, "", ""],
    ];
    const records = parseRegistryRows(readXlsxRows(registerXlsx(rows)));
    expect([...records.keys()]).toEqual([9896531]);
    expect(records.get(9896531).name).toBe("FIRST");
  });

  it("converts horsepower to kilowatts", () => {
    const row = [1.0, "TUG", "9000001", "", "1975", "", 300.0, 30.0, 2000.0, "BRAKE HORSEPOWER"];
    expect(parseRegistryRows(readXlsxRows(registerXlsx([row]))).get(9000001).enginePowerKw).toBe(1491);
  });
});

describe("createVesselRegistry", () => {
  const response = (body) => ({ ok: true, arrayBuffer: async () => body });

  it("downloads the register and looks ships up by IMO number", async () => {
    const fetchImpl = vi.fn(async () => response(registerXlsx([EQUINOX])));
    const registry = createVesselRegistry({ fetchImpl });
    await registry.refresh();
    expect(registry.lookup(9613927)).toMatchObject({ name: "ALGOMA EQUINOX", grossTonnage: 24451 });
    expect(registry.lookup(9999999)).toBeUndefined();
    expect(registry.lookup(undefined)).toBeUndefined();
    registry.close();
  });

  it("keeps the stored register when a download has no ships", async () => {
    const bodies = [registerXlsx([EQUINOX]), registerXlsx([])];
    const registry = createVesselRegistry({ fetchImpl: async () => response(bodies.shift()) });
    await registry.refresh();
    await expect(registry.refresh()).rejects.toThrow("no ships");
    expect(registry.lookup(9613927)).toBeDefined();
    registry.close();
  });

  it("imports on start when nothing is stored, and retries after a failure", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce(response(registerXlsx([EQUINOX])));
      const registry = createVesselRegistry({ fetchImpl, retryMs: 1000 });
      registry.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(registry.lookup(9613927)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(registry.lookup(9613927)).toBeDefined();
      registry.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
