// Aircraft messages from the WebSocket server (server/aircraft.js), which sends the
// full list on subscribe and after each poll of its ADS-B feed

import type { Aircraft } from "../types/aircraft";

export interface AircraftMessage {
  type: "aircraft";
  aircraft: Aircraft[];
}

/** The aircraft in an aircraft message, or null for anything that isn't one */
export function parseAircraftMessage(data: unknown): Aircraft[] | null {
  const message = data as AircraftMessage | null;
  return message?.type === "aircraft" && Array.isArray(message.aircraft) ? message.aircraft : null;
}

/** Callsign, else registration, else the ICAO address */
export function aircraftLabel(aircraft: Aircraft): string {
  return aircraft.callsign || aircraft.registration || aircraft.hex.toUpperCase();
}

/** "On ground", "3,500 ft", or null when unknown */
export function formatAltitude(aircraft: Aircraft): string | null {
  if (aircraft.onGround) return "On ground";
  if (aircraft.altitude === undefined) return null;
  return `${aircraft.altitude.toLocaleString("en-US")} ft`;
}

/** Helicopters and other rotorcraft (ADS-B emitter category A7) */
export function isRotorcraft(aircraft: Aircraft): boolean {
  return aircraft.category === "A7";
}

/** Arrow for climbing or descending faster than 300 ft/min, else "" */
export function verticalTrend(aircraft: Aircraft): string {
  const rate = aircraft.verticalRate ?? 0;
  return rate > 300 ? "↑" : rate < -300 ? "↓" : "";
}
