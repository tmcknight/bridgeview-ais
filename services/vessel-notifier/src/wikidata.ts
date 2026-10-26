import type { VesselInfo } from "./types.js";

// Query building and parsing mirror src/utils/wikidata.ts in the web app

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const THUMBNAIL_WIDTH = 480;
// Wikimedia requires automated clients to identify themselves
const USER_AGENT =
  "BridgeViewAIS-notifier/1.0 (https://github.com/tmcknight/bridgeview-ais)";

const HIT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FAILURE_TTL_MS = 5 * 60 * 1000; // retry failed lookups after 5 minutes

interface SparqlValue {
  type: string;
  value: string;
}

interface SparqlResponse {
  results: {
    bindings: Record<string, SparqlValue | undefined>[];
  };
}

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
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Wikidata query failed: ${response.status}`);
  }
  const data = (await response.json()) as SparqlResponse;
  const row = data.results.bindings[0];
  return row ? parseVesselBinding(row) : null;
}

interface CacheEntry {
  promise: Promise<VesselInfo | null>;
  expiresAt: number;
}

/**
 * Looks up vessel details on Wikidata, caching results so a vessel is
 * queried once while it is in the area. Call `prefetch` as vessels are seen
 * so the result is ready by the time they reach a watch point.
 */
export class VesselInfoLookup {
  private cache = new Map<string, CacheEntry>();

  /** Start a lookup in the background if one isn't cached. */
  prefetch(mmsi: number, imo?: number): void {
    this.lookup(mmsi, imo);
  }

  /**
   * Resolve vessel details, waiting at most `timeoutMs` so alerts are not
   * held up by a slow lookup. Never rejects.
   */
  async get(mmsi: number, imo: number | undefined, timeoutMs: number): Promise<VesselInfo | null> {
    const promise = this.lookup(mmsi, imo);
    if (!promise) return null;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Drop expired cache entries. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  private lookup(mmsi: number, imo?: number): Promise<VesselInfo | null> | null {
    const query = buildVesselQuery(mmsi, imo);
    if (!query) return null;

    const key = `${isValidMmsi(mmsi) ? mmsi : ""}:${isValidImo(imo) ? imo : ""}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const entry: CacheEntry = {
      expiresAt: Date.now() + HIT_TTL_MS,
      promise: queryVesselInfo(query).catch((error) => {
        console.error(
          `[notifier] Wikidata lookup failed for MMSI ${mmsi}: ${error instanceof Error ? error.message : error}`
        );
        entry.expiresAt = Date.now() + FAILURE_TTL_MS;
        return null;
      }),
    };
    this.cache.set(key, entry);
    return entry.promise;
  }
}
