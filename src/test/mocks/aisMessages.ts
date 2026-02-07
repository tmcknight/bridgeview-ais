import type { AISMessage, PositionReport, ShipStaticData } from '../../types/ais'

/**
 * Create a mock PositionReport with default values
 */
export const mockPositionReport = (overrides?: Partial<PositionReport>): PositionReport => ({
  Cog: 180,
  CommunicationState: 0,
  Latitude: 43.05,
  Longitude: -82.42,
  MessageID: 1,
  NavigationalStatus: 0,
  PositionAccuracy: true,
  Raim: false,
  RateOfTurn: 0,
  RepeatIndicator: 0,
  Sog: 10.5,
  Spare: 0,
  SpecialManoeuvreIndicator: 0,
  Timestamp: 30,
  TrueHeading: 180,
  UserID: 367123456,
  Valid: true,
  ...overrides,
})

/**
 * Create a mock ShipStaticData with default values
 */
export const mockShipStaticData = (overrides?: Partial<ShipStaticData>): ShipStaticData => ({
  AisVersion: 0,
  CallSign: 'WXY123',
  Destination: 'DETROIT',
  Dimension: {
    A: 150,
    B: 50,
    C: 15,
    D: 15,
  },
  Draught: 8.5,
  Dte: false,
  Eta: {
    Day: 15,
    Hour: 14,
    Minute: 30,
    Month: 1,
  },
  ImoNumber: 1234567,
  MaximumStaticDraught: 9.0,
  MessageID: 5,
  Name: 'TEST VESSEL',
  RepeatIndicator: 0,
  Spare: false,
  Type: 70,
  UserID: 367123456,
  Valid: true,
  ...overrides,
})

/**
 * Create a complete AIS position message
 */
export const mockAISPositionMessage = (
  mmsi: number = 367123456,
  lat: number = 43.05,
  lon: number = -82.42,
  cog: number = 180,
  sog: number = 10.5
): AISMessage => ({
  MessageType: 'PositionReport',
  MetaData: {
    MMSI: mmsi,
    MMSI_String: mmsi.toString(),
    ShipName: 'TEST VESSEL',
    latitude: lat,
    longitude: lon,
    time_utc: new Date().toISOString(),
  },
  Message: {
    PositionReport: mockPositionReport({
      Cog: cog,
      Sog: sog,
      Latitude: lat,
      Longitude: lon,
      UserID: mmsi,
    }),
  },
})

/**
 * Create a complete AIS static data message
 */
export const mockAISStaticDataMessage = (
  mmsi: number = 367123456,
  shipName: string = 'TEST VESSEL',
  destination: string = 'DETROIT'
): AISMessage => ({
  MessageType: 'ShipStaticData',
  MetaData: {
    MMSI: mmsi,
    MMSI_String: mmsi.toString(),
    ShipName: shipName,
    latitude: 43.05,
    longitude: -82.42,
    time_utc: new Date().toISOString(),
  },
  Message: {
    ShipStaticData: mockShipStaticData({
      Name: shipName,
      Destination: destination,
      UserID: mmsi,
    }),
  },
})

/**
 * Create an AIS message with compact time format (for testing time parsing)
 */
export const mockAISMessageWithCompactTime = (mmsi: number = 367123456): AISMessage => ({
  MessageType: 'PositionReport',
  MetaData: {
    MMSI: mmsi,
    MMSI_String: mmsi.toString(),
    ShipName: 'TEST VESSEL',
    latitude: 43.05,
    longitude: -82.42,
    time_utc: '20240115123456', // Compact format: YYYYMMDDHHmmss
  },
  Message: {
    PositionReport: mockPositionReport({ UserID: mmsi }),
  },
})

/**
 * Create an AIS message with invalid time format (for testing error handling)
 */
export const mockAISMessageWithInvalidTime = (mmsi: number = 367123456): AISMessage => ({
  MessageType: 'PositionReport',
  MetaData: {
    MMSI: mmsi,
    MMSI_String: mmsi.toString(),
    ShipName: 'TEST VESSEL',
    latitude: 43.05,
    longitude: -82.42,
    time_utc: 'invalid-time-format',
  },
  Message: {
    PositionReport: mockPositionReport({ UserID: mmsi }),
  },
})

/**
 * Create an authentication confirmation message
 */
export const mockAuthenticatedMessage = () => ({
  type: 'authenticated',
})
