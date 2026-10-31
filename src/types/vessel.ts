// Supplementary vessel details: from Wikidata (by MMSI / IMO), Wikimedia
// Commons, USCG PSIX and Transport Canada's register (server/vessel-info.js). The browser's own
// fallback lookup (utils/wikidata.ts) only has the Wikidata part.

export interface VesselInfo {
  wikidataId?: string;
  wikidataUrl?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  imagePageUrl?: string;
  yearBuilt?: number;
  builder?: string;
  operator?: string;
  grossTonnage?: number;
  wikipediaUrl?: string;
  // Photos from Wikimedia Commons, best first (server/commons.js)
  photos?: VesselPhoto[];
  // The ship's Transport Canada register record (server/vessel-registry.js)
  registry?: RegistryRecord;
  // The ship's USCG PSIX record (server/uscg-psix.js)
  uscg?: UscgRecord;
}

// A ship photo on Wikimedia Commons, with the credit its licence asks for
export interface VesselPhoto {
  url: string;
  pageUrl?: string;
  title?: string;
  artist?: string;
  license?: string;
  year?: number;
}

// One USCG inspection of a ship
export interface UscgInspection {
  date: string;
  // The Coast Guard zone that inspected the ship
  zone?: string;
  portStateControl: boolean;
  deficiencies: number;
  unresolved: number;
  // Operational controls (detentions, orders)
  controls: number;
  // Systems the deficiencies were in, e.g. "Fire Fighting"
  systems: string[];
}

// A ship's USCG inspections over the last few years, the latest in detail
export interface UscgInspections {
  count: number;
  sinceYear: number;
  recent: UscgInspection[];
}

// A ship's record in the USCG's Port State Information Exchange
export interface UscgRecord {
  source: "uscg";
  vesselId: number;
  name?: string;
  officialNumber?: string;
  flag?: string;
  serviceType?: string;
  serviceSubType?: string;
  yearBuilt?: number;
  status?: string;
  grossTonnage?: number;
  deadweight?: number;
  inspections?: UscgInspections;
}

// A ship's entry in Transport Canada's register of large vessels
export interface RegistryRecord {
  source: "transport-canada";
  officialNumber?: string;
  name?: string;
  hullNumber?: string;
  vesselType?: string;
  yearBuilt?: number;
  yearRebuilt?: number;
  portOfRegistry?: string;
  grossTonnage?: number;
  netTonnage?: number;
  length?: number;
  breadth?: number;
  depth?: number;
  speed?: number;
  enginePowerKw?: number;
}
