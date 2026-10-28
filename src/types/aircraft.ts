// Aircraft near the bridge, from the server's ADS-B feed (server/aircraft.js)

export interface Aircraft {
  /** ICAO 24-bit address, lowercase hex */
  hex: string;
  lat: number;
  lon: number;
  callsign?: string;
  registration?: string;
  /** ICAO type designator, e.g. "B738" */
  type?: string;
  /** Barometric altitude in feet */
  altitude?: number;
  onGround?: boolean;
  /** Ground speed in knots */
  speed?: number;
  /** Track over the ground in degrees */
  track?: number;
  /** Climb (positive) or descent rate in feet per minute */
  verticalRate?: number;
  squawk?: string;
  /** ADS-B emitter category, e.g. "A3" (large), "A7" (rotorcraft) */
  category?: string;
}
