// Wikidata lookup of a ship's photo, build year, builder, operator and tonnage,
// by MMSI (P587) or IMO number (P458). Mirrors src/utils/wikidata.ts, which the
// browser falls back to when the server hasn't looked a ship up yet.

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const THUMBNAIL_WIDTH = 480;
// Wikimedia asks automated clients to identify themselves
const USER_AGENT = "BridgeViewAIS/1.0 (https://github.com/tmcknight/bridgeview-ais)";

export function isValidMmsi(mmsi) {
  return Number.isInteger(mmsi) && mmsi >= 100_000_000 && mmsi <= 999_999_999;
}

export function isValidImo(imo) {
  return Number.isInteger(imo) && imo >= 1_000_000 && imo <= 9_999_999;
}

// IMO coverage on Wikidata is much better than MMSI, so both are tried.
// Ships with an image or Wikipedia article sort first when several match.
export function buildVesselQuery(mmsi, imo) {
  const patterns = [];
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

function toHttps(url) {
  return url.replace(/^http:\/\//, "https://");
}

// Convert a SPARQL result row into the VesselInfo shape in src/types/vessel.ts
export function parseVesselBinding(row) {
  const shipUri = row.ship?.value;
  if (!shipUri) return null;

  const wikidataId = shipUri.split("/").pop() ?? shipUri;
  const info = {
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

// Resolves to the ship's VesselInfo, or null when Wikidata has no match.
// Rejects when the lookup itself fails, so the caller can try again later.
export async function fetchVesselInfo(mmsi, imo, fetchImpl = fetch) {
  const query = buildVesselQuery(mmsi, imo);
  if (!query) return null;

  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Wikidata query failed: ${response.status}`);
  const data = await response.json();
  const row = data.results?.bindings?.[0];
  return row ? parseVesselBinding(row) : null;
}
