import { createHmac } from "node:crypto";
import { NAV_STATUS_LABELS } from "./types.js";
import type { PassageEvent } from "./types.js";

export interface WebhookConfig {
  /** URL to POST passage events to */
  url: string;
  /** Shared secret used to sign payloads (optional) */
  secret?: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

/** JSON body POSTed to the webhook */
export interface WebhookPayload {
  event: "vessel.passage";
  timestamp: string;
  watchPoint: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusNM: number;
  };
  distanceNM: number;
  closestApproachNM: number;
  direction: "northbound" | "southbound";
  vessel: {
    mmsi: number;
    name: string;
    imo?: number;
    callSign?: string;
    shipType?: number;
    destination?: string;
    lengthM?: number;
    beamM?: number;
    latitude: number;
    longitude: number;
    speedKnots: number;
    courseDeg: number;
    headingDeg?: number;
    navStatus?: number;
    navStatusLabel?: string;
  };
}

export const SIGNATURE_HEADER = "X-BridgeView-Signature";

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Client for POSTing passage events to an arbitrary webhook as JSON.
 *
 * When a secret is configured, each request carries an
 * `X-BridgeView-Signature: sha256=<hex>` header containing the HMAC-SHA256
 * of the raw request body, so receivers can verify the sender.
 */
export class WebhookClient {
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  /**
   * Convert a passage event into the webhook payload.
   */
  formatPayload(event: PassageEvent): WebhookPayload {
    const { watchPoint } = event;

    return {
      event: "vessel.passage",
      timestamp: new Date(event.timestamp).toISOString(),
      watchPoint: {
        id: watchPoint.id,
        name: watchPoint.name,
        latitude: watchPoint.latitude,
        longitude: watchPoint.longitude,
        radiusNM: watchPoint.radiusNM,
      },
      distanceNM: round(event.distance, 3),
      closestApproachNM: round(event.closestApproach, 3),
      direction: event.direction,
      vessel: {
        mmsi: event.mmsi,
        name: event.name,
        imo: event.imo,
        callSign: event.callSign,
        shipType: event.shipType,
        destination: event.destination,
        lengthM: event.length,
        beamM: event.beam,
        latitude: event.latitude,
        longitude: event.longitude,
        speedKnots: event.speed,
        courseDeg: event.course,
        headingDeg: event.heading,
        navStatus: event.navStatus,
        navStatusLabel:
          event.navStatus !== undefined ? NAV_STATUS_LABELS[event.navStatus] : undefined,
      },
    };
  }

  /**
   * Sign a request body with the configured secret.
   */
  sign(body: string): string {
    return `sha256=${createHmac("sha256", this.config.secret ?? "").update(body).digest("hex")}`;
  }

  /**
   * Send a passage event to the webhook.
   */
  async sendPassage(event: PassageEvent): Promise<boolean> {
    const body = JSON.stringify(this.formatPayload(event));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "bridgeview-vessel-notifier",
    };

    if (this.config.secret) {
      headers[SIGNATURE_HEADER] = this.sign(body);
    }

    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
      });

      if (!response.ok) {
        console.error(
          `[notifier] webhook request failed: ${response.status} ${response.statusText}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `[notifier] webhook request error: ${error instanceof Error ? error.message : error}`
      );
      return false;
    }
  }
}
