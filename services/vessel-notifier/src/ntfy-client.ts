import type { BridgeCrossingEvent } from "./types.js";

export interface NtfyConfig {
  /** ntfy server URL */
  server: string;
  /** ntfy topic */
  topic: string;
  /** ntfy access token (optional) */
  token?: string;
}

export interface NtfyMessage {
  topic: string;
  title: string;
  message: string;
  tags: string[];
  priority: number;
  click?: string;
}

/**
 * Client for sending notifications via ntfy (https://ntfy.sh).
 */
export class NtfyClient {
  private config: NtfyConfig;

  constructor(config: NtfyConfig) {
    this.config = config;
  }

  /**
   * Format a bridge crossing event into an ntfy message.
   */
  formatMessage(event: BridgeCrossingEvent): NtfyMessage {
    const directionEmoji = event.direction === "northbound" ? "⬆️" : "⬇️";
    const directionLabel =
      event.direction === "northbound" ? "Northbound" : "Southbound";

    const title = `${event.name} passing under Blue Water Bridge`;

    const lines = [
      `${directionEmoji} ${directionLabel} at ${event.speed.toFixed(1)} knots`,
      `MMSI: ${event.mmsi}`,
      `Course: ${Math.round(event.course)}°`,
    ];

    if (event.destination) {
      lines.push(`Destination: ${event.destination}`);
    }

    if (event.length) {
      lines.push(`Length: ${event.length}m`);
    }

    return {
      topic: this.config.topic,
      title,
      message: lines.join("\n"),
      tags: ["ship", directionLabel.toLowerCase()],
      priority: 3, // default priority
    };
  }

  /**
   * Send a bridge crossing notification via ntfy.
   */
  async sendCrossingNotification(
    event: BridgeCrossingEvent
  ): Promise<boolean> {
    const ntfyMessage = this.formatMessage(event);
    return this.send(ntfyMessage);
  }

  /**
   * Send a message to ntfy.
   */
  async send(message: NtfyMessage): Promise<boolean> {
    const url = `${this.config.server}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.token) {
      headers["Authorization"] = `Bearer ${this.config.token}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        console.error(
          `[notifier] ntfy request failed: ${response.status} ${response.statusText}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `[notifier] ntfy request error: ${error instanceof Error ? error.message : error}`
      );
      return false;
    }
  }
}
