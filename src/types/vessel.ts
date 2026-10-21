// Supplementary vessel details looked up from Wikidata by MMSI / IMO

export interface VesselInfo {
  wikidataId: string;
  wikidataUrl: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  imagePageUrl?: string;
  yearBuilt?: number;
  builder?: string;
  operator?: string;
  grossTonnage?: number;
  wikipediaUrl?: string;
}
