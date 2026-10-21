import type { VesselInfo } from "../types/vessel";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const THUMBNAIL_WIDTH = 480;

interface SparqlValue {
  type: string;
  value: string;
}

interface SparqlResponse {
  results: {
    bindings: Record<string, SparqlValue | undefined>[];
  };
}

// Cache results (including misses) for the session so re-selecting a ship is free
const cache = new Map<string, Promise<VesselInfo | null>>();

function isValidMmsi(mmsi: number | undefined): mmsi is number {
  return mmsi !== undefined && Number.isInteger(mmsi) && mmsi >= 100_000_000 && mmsi <= 999_999_999;
}

function isValidImo(imo: number | undefined): imo is number {
  return imo !== undefined && Number.isInteger(imo) && imo >= 1_000_000 && imo <= 9_999_999;
}

/**
 * Build a SPARQL query matching a ship by MMSI (P587) or IMO number (P458).
 * IMO coverage on Wikidata is much better than MMSI, so both are tried.
 * Ships with an image or Wikipedia article sort first when several match.
 */
export function buildVesselQuery(mmsi?: number, imo?: number): string | null {
  const patterns: string[] = [];
  if (isValidMmsi(mmsi)) patterns.push(`{ ?ship wdt:P587 "${mmsi}" }`);
  if (isValidImo(imo)) patterns.push(`{ ?ship wdt:P458 "${imo}" }`);
  if (patterns.length === 0) return null;

  return `SELECT ?ship (SAMPLE(?label) AS ?name) (SAMPLE(?desc) AS ?description)
  (SAMPLE(?image) AS ?img) (MIN(?inception) AS ?built) (SAMPLE(?builderLabel) AS ?builder)
  (SAMPLE(?operatorLabel) AS ?operator) (MAX(?gt) AS ?grossTonnage) (SAMPLE(?article) AS ?wiki)
WHERE {
  ${patterns.join(" UNION ")}
  OPTIONAL { ?ship rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?ship schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?ship wdt:P18 ?image }
  OPTIONAL { ?ship wdt:P571|wdt:P729 ?inception }
  OPTIONAL { ?ship wdt:P176 ?b . ?b rdfs:label ?builderLabel FILTER(LANG(?builderLabel) = "en") }
  OPTIONAL { ?ship wdt:P137 ?o . ?o rdfs:label ?operatorLabel FILTER(LANG(?operatorLabel) = "en") }
  OPTIONAL { ?ship wdt:P1093 ?gt }
  OPTIONAL { ?article schema:about ?ship ; schema:isPartOf <https://en.wikipedia.org/> }
}
GROUP BY ?ship
ORDER BY DESC(BOUND(?img)) DESC(BOUND(?wiki))
LIMIT 1`;
}

function toHttps(url: string): string {
  return url.replace(/^http:\/\//, "https://");
}

/**
 * Convert a SPARQL result row into a VesselInfo.
 */
export function parseVesselBinding(row: Record<string, SparqlValue | undefined>): VesselInfo | null {
  const shipUri = row.ship?.value;
  if (!shipUri) return null;

  const wikidataId = shipUri.split("/").pop() ?? shipUri;
  const info: VesselInfo = {
    wikidataId,
    wikidataUrl: `https://www.wikidata.org/wiki/${wikidataId}`,
  };

  if (row.name?.value) info.name = row.name.value;
  if (row.description?.value) info.description = row.description.value;
  if (row.img?.value) {
    // Special:FilePath redirects to the file; ?width= returns a scaled thumbnail
    const filePath = toHttps(row.img.value);
    info.imageUrl = `${filePath}?width=${THUMBNAIL_WIDTH}`;
    info.imagePageUrl = filePath.replace("/wiki/Special:FilePath/", "/wiki/File:");
  }
  if (row.built?.value) {
    const year = new Date(row.built.value).getUTCFullYear();
    if (!Number.isNaN(year)) info.yearBuilt = year;
  }
  if (row.builder?.value) info.builder = row.builder.value;
  if (row.operator?.value) info.operator = row.operator.value;
  if (row.grossTonnage?.value) {
    const gt = Number(row.grossTonnage.value);
    if (Number.isFinite(gt)) info.grossTonnage = Math.round(gt);
  }
  if (row.wiki?.value) info.wikipediaUrl = row.wiki.value;

  return info;
}

async function queryVesselInfo(query: string): Promise<VesselInfo | null> {
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      // Wikimedia asks browser clients to identify themselves via Api-User-Agent
      "Api-User-Agent": "BridgeViewAIS/1.0 (https://github.com/tmcknight/bridgeview-ais)",
    },
  });
  if (!response.ok) {
    throw new Error(`Wikidata query failed: ${response.status}`);
  }
  const data = (await response.json()) as SparqlResponse;
  const row = data.results.bindings[0];
  return row ? parseVesselBinding(row) : null;
}

/**
 * Look up supplementary vessel details on Wikidata by MMSI and/or IMO number.
 * Resolves to null when no match is found. Failed lookups are not cached.
 */
export function fetchVesselInfo(mmsi?: number, imo?: number): Promise<VesselInfo | null> {
  const query = buildVesselQuery(mmsi, imo);
  if (!query) return Promise.resolve(null);

  const key = `${isValidMmsi(mmsi) ? mmsi : ""}:${isValidImo(imo) ? imo : ""}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = queryVesselInfo(query).catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, promise);
  return promise;
}

/** Clear the lookup cache (used by tests). */
export function clearVesselInfoCache(): void {
  cache.clear();
}
