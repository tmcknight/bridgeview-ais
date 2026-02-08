import WebSocket from "ws";
import { BridgeDetector } from "./bridge-detector.js";
import { NtfyClient } from "./ntfy-client.js";
import { AIS_BOUNDING_BOX } from "./geo.js";
import type { AISMessage, NotifierConfig } from "./types.js";

const DEFAULT_CONFIG: NotifierConfig = {
  ntfyServer: "https://ntfy.sh",
  ntfyTopic: "bridgeview-ais",
  wsProxyUrl: "ws://localhost:3001",
  bridgeThresholdNM: 0.5,
  notificationCooldownMs: 30 * 60 * 1000,
  staleVesselTimeoutMs: 15 * 60 * 1000,
};

/**
 * Main vessel notification service.
 * Connects to the WebSocket proxy, tracks vessels, and sends
 * ntfy notifications when vessels pass under the Blue Water Bridge.
 */
export class VesselNotifier {
  private config: NotifierConfig;
  private detector: BridgeDetector;
  private ntfy: NtfyClient;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private reconnectDelay = 2000;
  private maxReconnectDelay = 60000;

  constructor(config: Partial<NotifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.detector = new BridgeDetector({
      thresholdNM: this.config.bridgeThresholdNM,
      cooldownMs: this.config.notificationCooldownMs,
      staleTimeoutMs: this.config.staleVesselTimeoutMs,
    });
    this.ntfy = new NtfyClient({
      server: this.config.ntfyServer,
      topic: this.config.ntfyTopic,
      token: this.config.ntfyToken,
    });
  }

  /** Start the notification service */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[notifier] Starting vessel notification service");
    console.log(`[notifier] ntfy topic: ${this.config.ntfyTopic}`);
    console.log(`[notifier] WebSocket proxy: ${this.config.wsProxyUrl}`);
    console.log(
      `[notifier] Bridge threshold: ${this.config.bridgeThresholdNM} NM`
    );
    this.connect();
    this.startCleanupInterval();
  }

  /** Stop the notification service */
  stop(): void {
    this.running = false;
    console.log("[notifier] Stopping vessel notification service");

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.running) return;

    console.log(`[notifier] Connecting to ${this.config.wsProxyUrl}...`);

    try {
      this.ws = new WebSocket(this.config.wsProxyUrl);
    } catch (error) {
      console.error(
        `[notifier] Connection creation failed: ${error instanceof Error ? error.message : error}`
      );
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      console.log("[notifier] Connected to WebSocket proxy");
      this.reconnectDelay = 2000; // Reset backoff on successful connection

      // Send auth token if configured
      if (this.config.wsAuthToken) {
        this.ws!.send(
          JSON.stringify({ authToken: this.config.wsAuthToken })
        );
        return; // Wait for auth response before subscribing
      }

      this.subscribe();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      console.log(
        `[notifier] WebSocket closed: ${code} ${reason.toString()}`
      );
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on("error", (error: Error) => {
      console.error(`[notifier] WebSocket error: ${error.message}`);
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscription = {
      BoundingBoxes: [AIS_BOUNDING_BOX],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };

    this.ws.send(JSON.stringify(subscription));
    console.log("[notifier] Subscribed to AIS data");
  }

  private handleMessage(data: WebSocket.Data): void {
    let message: AISMessage;

    try {
      const parsed = JSON.parse(data.toString());

      // Handle auth response
      if (parsed.type === "authenticated") {
        console.log("[notifier] Authenticated successfully");
        this.subscribe();
        return;
      }

      message = parsed as AISMessage;
    } catch {
      return; // Ignore unparseable messages
    }

    if (!message.MessageType || !message.MetaData) return;

    const event = this.detector.processMessage(message);

    if (event) {
      console.log(
        `[notifier] Bridge crossing detected: ${event.name} (MMSI: ${event.mmsi}) ${event.direction} at ${event.speed.toFixed(1)} kn`
      );

      this.ntfy.sendCrossingNotification(event).then((success) => {
        if (success) {
          console.log(`[notifier] Notification sent for ${event.name}`);
        } else {
          console.error(
            `[notifier] Failed to send notification for ${event.name}`
          );
        }
      });
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;

    console.log(
      `[notifier] Reconnecting in ${this.reconnectDelay / 1000}s...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }

  private startCleanupInterval(): void {
    // Clean up stale vessels every 5 minutes
    this.cleanupTimer = setInterval(() => {
      const removed = this.detector.cleanupStale();
      if (removed > 0) {
        console.log(
          `[notifier] Cleaned up ${removed} stale vessels. Tracking: ${this.detector.trackedCount}`
        );
      }
    }, 5 * 60 * 1000);
  }

  /** Get service status (for health checks) */
  get status() {
    return {
      running: this.running,
      connected: this.ws?.readyState === WebSocket.OPEN,
      trackedVessels: this.detector.trackedCount,
      cooldownVessels: this.detector.cooldownCount,
    };
  }
}
