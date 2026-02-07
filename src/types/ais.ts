// AIS Stream API types

export interface AISSubscription {
  Apikey: string;
  BoundingBoxes: [number, number][][];
  FilterMessageTypes?: string[];
  FiltersShipMMSI?: string[];
}

export interface AISMetaData {
  MMSI: number;
  MMSI_String: string;
  ShipName: string;
  latitude: number;
  longitude: number;
  time_utc: string;
}

export interface PositionReport {
  Cog: number;
  CommunicationState: number;
  Latitude: number;
  Longitude: number;
  MessageID: number;
  NavigationalStatus: number;
  PositionAccuracy: boolean;
  Raim: boolean;
  RateOfTurn: number;
  RepeatIndicator: number;
  Sog: number;
  Spare: number;
  SpecialManoeuvreIndicator: number;
  Timestamp: number;
  TrueHeading: number;
  UserID: number;
  Valid: boolean;
}

export interface ShipStaticData {
  AisVersion: number;
  CallSign: string;
  Destination: string;
  Dimension: {
    A: number;
    B: number;
    C: number;
    D: number;
  };
  Draught: number;
  Dte: boolean;
  Eta: {
    Day: number;
    Hour: number;
    Minute: number;
    Month: number;
  };
  ImoNumber: number;
  MaximumStaticDraught: number;
  MessageID: number;
  Name: string;
  RepeatIndicator: number;
  Spare: boolean;
  Type: number;
  UserID: number;
  Valid: boolean;
}

export interface AISMessage {
  Message: {
    PositionReport?: PositionReport;
    ShipStaticData?: ShipStaticData;
  };
  MessageType: string;
  MetaData: AISMetaData;
}

export interface TrackedShip {
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  cog: number;
  sog: number;
  trueHeading: number;
  navStatus: number;
  lastUpdate: string;
  distanceToBridge: number;
  approaching: boolean;
  notified: boolean;
  destination?: string;
  shipType?: number;
  length?: number;
  width?: number;
}

export const NAV_STATUS_LABELS: Record<number, string> = {
  0: "Under way using engine",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Engaged in fishing",
  8: "Under way sailing",
  9: "Reserved (HSC)",
  10: "Reserved (WIG)",
  11: "Power-driven vessel towing astern",
  12: "Power-driven vessel pushing ahead",
  13: "Reserved",
  14: "AIS-SART, MOB-AIS, EPIRB-AIS",
  15: "Undefined",
};
