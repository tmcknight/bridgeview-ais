import { describe, it, expect, vi } from "vitest";
import { fetchInspections, fetchPsixRecord, INSPECTIONS_DETAILED, parseDataset, parseRecords, parseTonnage } from "./uscg-psix.js";

// A PSIX SOAP response: the dataset comes back as escaped XML inside the result
function soap(operation, rows, tag) {
  const records = rows
    .map((row) => `<${tag}>${Object.entries(row).map(([k, v]) => `<${k}>${String(v).replace(/&/g, "&amp;")}</${k}>`).join("")}</${tag}>`)
    .join("");
  const dataset = `<NewDataSet>${records}</NewDataSet>`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0"?><soap:Envelope><soap:Body><${operation}Response><${operation}Result>${dataset}</${operation}Result></${operation}Response></soap:Body></soap:Envelope>`;
}

const INDIANA_HARBOR = {
  VesselId: 50383,
  VesselName: "INDIANA HARBOR",
  VesselCallSign: "WXN3191",
  ServiceType: "Freight Ship",
  ConstructionCompletedYear: 1979,
  StatusLookupName: "Active",
  Identification: 610401,
  CountryLookupName: "UNITED STATES",
};
const PARTICULARS = {
  ServiceType: "Freight Ship",
  ServiceSubType: "Self-Discharging",
  IdentificationTypeLookupName: "Official Number (U.S.)",
};
const TONNAGE = [
  { MeasureOfWeight: 62161, TonnageTypeLookupName: "Dead Weight", UnitOfMeasureLookupName: "Ton" },
  { MeasureOfWeight: 35923, TonnageTypeLookupName: "Regulatory (Subpart C or D)", UnitOfMeasureLookupName: "Long Ton" },
  { MeasureOfWeight: 33534, TonnageTypeLookupName: "Regulatory (Subpart C or D)", UnitOfMeasureLookupName: "Short Ton" },
];

// A fake PSIX answering each operation from `answers` (operation -> body)
function fakePsix(answers) {
  return vi.fn(async (url, { headers, body }) => {
    const operation = /cgmix\.uscg\.mil\/(\w+)/.exec(headers.SOAPAction)[1];
    const answer = answers[operation];
    const text = typeof answer === "function" ? answer(body) : answer;
    return { ok: true, text: async () => text ?? soap(operation, [], "None") };
  });
}

describe("parseRecords", () => {
  it("reads each record's fields, unescaping text", () => {
    expect(parseRecords("<A><Name>B &amp; C</Name><Year>1979</Year></A><A><Name>D</Name></A>", "A")).toEqual([
      { Name: "B & C", Year: "1979" },
      { Name: "D" },
    ]);
  });
});

describe("parseTonnage", () => {
  it("prefers international gross tonnage, then US regulatory, both in long tons", () => {
    expect(parseTonnage(parseRecords(soap("x", TONNAGE, "VesselTonnage").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), "VesselTonnage"))).toEqual({
      grossTonnage: 35923,
      deadweight: 62161,
    });
    const convention = [{ MeasureOfWeight: "20661", TonnageTypeLookupName: "Convention (Subpart B)", UnitOfMeasureLookupName: "Long Ton" }];
    expect(parseTonnage([...convention, ...TONNAGE.map((r) => ({ ...r, MeasureOfWeight: String(r.MeasureOfWeight) }))]).grossTonnage).toBe(20661);
  });
});

describe("fetchPsixRecord", () => {
  const details = {
    getVesselParticularsXMLString: soap("getVesselParticularsXMLString", [PARTICULARS], "VesselParticulars"),
    getVesselTonnageXMLString: soap("getVesselTonnageXMLString", TONNAGE, "VesselTonnage"),
  };

  it("finds a US ship by call sign when its IMO number finds nothing", async () => {
    const fetchImpl = fakePsix({
      getVesselSummaryXMLString: (body) =>
        body.includes("<CallSign>WXN3191</CallSign>")
          ? soap("getVesselSummaryXMLString", [INDIANA_HARBOR], "VesselSummary")
          : undefined,
      ...details,
    });
    expect(await fetchPsixRecord({ imo: 7514701, callSign: "WXN3191" }, fetchImpl)).toEqual({
      source: "uscg",
      vesselId: 50383,
      name: "INDIANA HARBOR",
      officialNumber: "610401",
      flag: "United States",
      serviceType: "Freight Ship",
      serviceSubType: "Self-Discharging",
      yearBuilt: 1979,
      status: "Active",
      grossTonnage: 35923,
      deadweight: 62161,
    });
    // Two summary searches, particulars, tonnage, and the (empty) inspection history
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("finds a foreign ship by IMO number, preferring the active record", async () => {
    const kumano = { ...INDIANA_HARBOR, VesselName: "FEDERAL KUMANO", Identification: 9244257, CountryLookupName: "MARSHALL ISLANDS" };
    const fetchImpl = fakePsix({
      getVesselSummaryXMLString: soap(
        "getVesselSummaryXMLString",
        [
          { ...kumano, VesselId: 1, StatusLookupName: "Inactive" },
          { ...kumano, VesselId: 2 },
          { ...kumano, VesselId: 3, Identification: 1234567 },
        ],
        "VesselSummary"
      ),
      ...details,
      getVesselParticularsXMLString: soap("getVesselParticularsXMLString", [{ IdentificationTypeLookupName: "IMO Number" }], "VesselParticulars"),
    });
    const record = await fetchPsixRecord({ imo: 9244257 }, fetchImpl);
    expect(record).toMatchObject({ vesselId: 2, name: "FEDERAL KUMANO", flag: "Marshall Islands" });
    expect(record.officialNumber).toBeUndefined();
  });

  it("is null without a match or anything to search by, and fails on errors", async () => {
    expect(await fetchPsixRecord({ imo: 9999999, callSign: "NONE" }, fakePsix({}))).toBeNull();
    const fetchImpl = fakePsix({});
    expect(await fetchPsixRecord({}, fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    const failing = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(fetchPsixRecord({ imo: 9244257 }, failing)).rejects.toThrow("500");
  });
});

describe("parseDataset", () => {
  it("reads records whatever their tag", () => {
    expect(parseDataset("<NewDataSet>\n  <Control><Type>Detention</Type></Control></NewDataSet>")).toEqual([{ Type: "Detention" }]);
    expect(parseDataset("<NewDataSet />")).toEqual([]);
  });
});

describe("fetchInspections", () => {
  const NOW = new Date("2026-10-31T12:00:00Z");
  const cases = Array.from({ length: 7 }, (_, i) => ({
    ActivityId: 100 + i,
    StartDtTm: `2026-0${8 - i}-03T17:29:09-04:00`,
    USCGZonePort: i === 0 ? "DETROIT, Michigan" : "Duluth, Minnesota",
    PortStateControlRelatedExamination: i === 1 ? "true" : "false",
  }));

  it("summarises the last three years, with details for the latest inspections", async () => {
    const fetchImpl = fakePsix({
      getVesselCasesXMLString: (body) => {
        expect(body).toContain("<MaxSearchDate>10/31/2026</MaxSearchDate><MinSearchDate>10/31/2023</MinSearchDate>");
        return soap("getVesselCasesXMLString", [...cases].reverse(), "VesselCases");
      },
      getVesselDeficienciesXMLString: (body) =>
        body.includes("<ActivityNumber>100</ActivityNumber>")
          ? soap(
              "getVesselDeficienciesXMLString",
              [
                { IsResolved: "true", SystemLookupName: "01 - Certificates & Documentation" },
                { IsResolved: "false", SystemLookupName: "07 - Fire Fighting" },
              ],
              "VesselDeficiencies"
            )
          : undefined,
      getOperationControlsXMLString: (body) =>
        body.includes("<ActivityID>101</ActivityID>") ? soap("getOperationControlsXMLString", [{ Type: "Detention" }], "Controls") : undefined,
    });

    const inspections = await fetchInspections(50383, fetchImpl, NOW);
    expect(inspections.count).toBe(7);
    expect(inspections.sinceYear).toBe(2023);
    expect(inspections.recent).toHaveLength(INSPECTIONS_DETAILED);
    expect(inspections.recent[0]).toEqual({
      date: "2026-08-03T21:29:09.000Z",
      zone: "Detroit, Michigan",
      portStateControl: false,
      deficiencies: 2,
      unresolved: 1,
      controls: 0,
      systems: ["Certificates & Documentation", "Fire Fighting"],
    });
    expect(inspections.recent[1]).toMatchObject({ portStateControl: true, deficiencies: 0, controls: 1 });
    // The cases query, then deficiencies and controls for each detailed inspection
    expect(fetchImpl).toHaveBeenCalledTimes(1 + 2 * INSPECTIONS_DETAILED);
  });

  it("is undefined without inspections", async () => {
    expect(await fetchInspections(50383, fakePsix({}), NOW)).toBeUndefined();
  });
});
