import { isValidImo } from "./wikidata.js";

// USCG Port State Information Exchange (PSIX): the Coast Guard's public
// vessel records, a weekly snapshot of its MISLE database, for US ships and
// foreign ships that call at US ports (most salties on the Seaway). Gives a
// ship's service type, build year, flag, gross tonnage and deadweight, and its
// Coast Guard inspections (when, which Coast Guard zone, deficiencies found, any
// operational controls such as detentions).
// A SOAP service; each lookup is a summary search, then detail queries.

const ENDPOINT = "https://cgmix.uscg.mil/xml/PSIXData.asmx";
const NAMESPACE = "https://cgmix.uscg.mil";
// PSIX has no link to one ship's page, so credit its search page
export const PSIX_URL = "https://cgmix.uscg.mil/psix/";

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(text) {
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]);
}

// Each <tag>…</tag> record in a PSIX result as { field: text }
export function parseRecords(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) =>
    Object.fromEntries([...m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(([, k, v]) => [k, unescapeXml(v).trim()]))
  );
}

// Records in a PSIX dataset whatever their tag (for results with no example to go by)
export function parseDataset(xml) {
  const tag = /<NewDataSet>\s*<(\w+)>/.exec(xml)?.[1];
  return tag ? parseRecords(xml, tag) : [];
}

// Calls a PSIX *XMLString operation; its result is a dataset as escaped XML
async function call(operation, params, fetchImpl) {
  const body = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(v ?? "")}</${k}>`)
    .join("");
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${NAMESPACE}/${operation}"` },
    body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${operation} xmlns="${NAMESPACE}">${body}</${operation}></soap:Body></soap:Envelope>`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`PSIX ${operation} failed: ${response.status}`);
  return unescapeXml(await response.text());
}

function summarySearch({ vin = "", callSign = "" }, fetchImpl) {
  const params = { VesselID: "", VesselName: "", CallSign: callSign, VIN: vin, HIN: "", Flag: "", Service: "", BuildYear: "" };
  return call("getVesselSummaryXMLString", params, fetchImpl).then((xml) => parseRecords(xml, "VesselSummary"));
}

// Inspection history: cases from the last few years, with deficiencies and
// operational controls (detentions, orders) for the most recent ones
export const INSPECTION_YEARS = 3;
export const INSPECTIONS_DETAILED = 5;

const positive = (text) => {
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function titleCase(text) {
  return text ? text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : undefined;
}

// Gross tonnage (international, else US regulatory) and deadweight from PSIX's
// tonnage rows, which list each measure in several units
export function parseTonnage(rows) {
  const find = (type, unit) =>
    positive(rows.find((r) => r.TonnageTypeLookupName?.startsWith(type) && r.UnitOfMeasureLookupName === unit)?.MeasureOfWeight);
  return {
    grossTonnage: find("Convention", "Long Ton") ?? find("Regulatory", "Long Ton"),
    deadweight: find("Dead Weight", "Ton"),
  };
}

// The best of several summary matches: the one with the ship's IMO number or
// call sign, active ones first
function pickSummary(summaries, { imo, callSign }) {
  const matching = summaries.filter(
    (s) => (imo && s.Identification === String(imo)) || (callSign && s.VesselCallSign?.toUpperCase() === callSign.toUpperCase())
  );
  return matching.find((s) => s.StatusLookupName === "Active") ?? matching[0];
}

function usDate(date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

// The ship's inspection summary (UscgInspections in src/types/vessel.ts), or
// undefined when it had none in the last INSPECTION_YEARS years
export async function fetchInspections(vesselId, fetchImpl = fetch, now = new Date()) {
  const since = new Date(now);
  since.setUTCFullYear(since.getUTCFullYear() - INSPECTION_YEARS);
  const casesXml = await call(
    "getVesselCasesXMLString",
    { VesselID: vesselId, MaxSearchDate: usDate(now), MinSearchDate: usDate(since) },
    fetchImpl
  );
  const cases = parseRecords(casesXml, "VesselCases")
    .filter((c) => c.ActivityId && Date.parse(c.StartDtTm))
    .sort((a, b) => Date.parse(b.StartDtTm) - Date.parse(a.StartDtTm));
  if (cases.length === 0) return undefined;

  // One at a time, to go easy on the Coast Guard's server
  const recent = [];
  for (const c of cases.slice(0, INSPECTIONS_DETAILED)) {
    const deficienciesXml = await call("getVesselDeficienciesXMLString", { ActivityNumber: c.ActivityId }, fetchImpl);
    const controlsXml = await call("getOperationControlsXMLString", { ActivityID: c.ActivityId }, fetchImpl);
    const deficiencies = parseRecords(deficienciesXml, "VesselDeficiencies");
    const inspection = {
      date: new Date(Date.parse(c.StartDtTm)).toISOString(),
      // The Coast Guard zone that inspected the ship, not necessarily the port it was in
      zone: c.USCGZonePort ? titleCase(c.USCGZonePort) : undefined,
      portStateControl: c.PortStateControlRelatedExamination === "true",
      deficiencies: deficiencies.length,
      unresolved: deficiencies.filter((d) => d.IsResolved === "false").length,
      controls: parseDataset(controlsXml).length,
      systems: [...new Set(deficiencies.map((d) => d.SystemLookupName?.replace(/^\d+\s*-\s*/, "")).filter(Boolean))],
    };
    recent.push(Object.fromEntries(Object.entries(inspection).filter(([, v]) => v !== undefined)));
  }
  return { count: cases.length, sinceYear: since.getUTCFullYear(), recent };
}

// Resolves to the ship's UscgRecord (src/types/vessel.ts), or null when PSIX
// has no match. Foreign ships are found by IMO number; US ships are filed under
// their official number, so they're found by call sign. Rejects on failure.
export async function fetchPsixRecord({ imo, callSign } = {}, fetchImpl = fetch, now = new Date()) {
  const ids = { imo: isValidImo(imo) ? imo : undefined, callSign: callSign?.trim() || undefined };
  let summary;
  if (ids.imo) summary = pickSummary(await summarySearch({ vin: ids.imo }, fetchImpl), ids);
  if (!summary && ids.callSign) summary = pickSummary(await summarySearch({ callSign: ids.callSign }, fetchImpl), ids);
  if (!summary?.VesselId) return null;

  const vesselId = Number(summary.VesselId);
  const [particularsXml, tonnageXml] = await Promise.all([
    call("getVesselParticularsXMLString", { VesselID: vesselId }, fetchImpl),
    call("getVesselTonnageXMLString", { VesselID: vesselId }, fetchImpl),
  ]);
  const particulars = parseRecords(particularsXml, "VesselParticulars")[0] ?? {};
  const inspections = await fetchInspections(vesselId, fetchImpl, now);
  const idType = particulars.IdentificationTypeLookupName ?? "";

  const record = {
    source: "uscg",
    vesselId,
    name: summary.VesselName || undefined,
    officialNumber: /Official Number/i.test(idType) ? summary.Identification : undefined,
    flag: titleCase(summary.CountryLookupName),
    serviceType: particulars.ServiceType || summary.ServiceType || undefined,
    serviceSubType: particulars.ServiceSubType || undefined,
    yearBuilt: positive(summary.ConstructionCompletedYear),
    status: summary.StatusLookupName || undefined,
    ...parseTonnage(parseRecords(tonnageXml, "VesselTonnage")),
    inspections,
  };
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
}
