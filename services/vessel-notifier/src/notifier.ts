import WebSocket from "ws";
import { WatchPointDetector, BLUE_WATER_BRIDGE } from "./watch-point-detector.js";
import { NtfyClient } from "./ntfy-client.js";
import { WebhookClient } from "./webhook-client.js";
import { VesselInfoLookup } from "./wikidata.js";
import { boundingBoxAround, TRACKING_PADDING_NM } from "./geo.js";
import type { AISMessage, NotifierConfig, PassageEvent } from "./types.js";

const DEFAULT_CONFIG: NotifierConfig = {
  ntfyServer: "https://ntfy.sh",
  wsProxyUrl: "ws://localhost:3001",
  bridgeThresholdNM: 0.5,
  notificationCooldownMs: 30 * 60 * 1000,
  staleVesselTimeoutMs: 15 * 60 * 1000,
  vesselInfoLookup: true,
};

/** Longest an alert waits for a Wikidata lookup that is still in flight */
const VESSEL_INFO_WAIT_MS = 1500;

/**
 * Main vessel notification service.
 * Connects to the WebSocket proxy, tracks vessels, and sends ntfy
 * notifications and/or webhooks when vessels pass a watch point.
 */
export class VesselNotifier {
  private config: NotifierConfig;
  private detector: WatchPointDetector;
  private ntfy: NtfyClient | null = null;
  private webhook: WebhookClient | null = null;
  private vesselInfo: VesselInfoLookup | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private reconnectDelay = 2000;
  private maxReconnectDelay = 60000;

  constructor(config: Partial<NotifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.detector = new WatchPointDetector({
      watchPoints: this.config.watchPoints ?? [
        { ...BLUE_WATER_BRIDGE, radiusNM: this.config.bridgeThresholdNM },
      ],
      cooldownMs: this.config.notificationCooldownMs,
      staleTimeoutMs: this.config.staleVesselTimeoutMs,
      ...(this.config.predictionHorizonSeconds !== undefined && {
        predictionHorizonSeconds: this.config.predictionHorizonSeconds,
      }),
      ...(this.config.predictionLeadSeconds !== undefined && {
        predictionLeadSeconds: this.config.predictionLeadSeconds,
      }),
      onPredictedPassage: (event) => void this.dispatch(event),
    });
    if (this.config.ntfyTopic) {
      this.ntfy = new NtfyClient({
        server: this.config.ntfyServer,
        topic: this.config.ntfyTopic,
        token: this.config.ntfyToken,
      });
    }
    if (this.config.vesselInfoLookup) {
      this.vesselInfo = new VesselInfoLookup();
    }
    if (this.config.webhookUrl) {
      this.webhook = new WebhookClient({
        url: this.config.webhookUrl,
        secret: this.config.webhookSecret,
      });
    }
  }

  /** Start the notification service */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[notifier] Starting vessel notification service");
    if (this.ntfy) console.log(`[notifier] ntfy topic: ${this.config.ntfyTopic}`);
    if (this.webhook) console.log("[notifier] Webhook: enabled");
    console.log(`[notifier] WebSocket proxy: ${this.config.wsProxyUrl}`);
    for (const point of this.detector.watchPoints) {
      console.log(
        `[notifier] Watching ${point.name} (${point.latitude}, ${point.longitude}) within ${point.radiusNM} NM`
      );
    }
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

    this.detector.dispose();

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
      BoundingBoxes: this.detector.watchPoints.map((point) =>
        boundingBoxAround(
          point.latitude,
          point.longitude,
          point.radiusNM + TRACKING_PADDING_NM
        )
      ),
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

    const events = this.detector.processMessage(message);

    // Look vessels up while they approach so details are ready at the passage
    const vessel = this.detector.getVessel(message.MetaData.MMSI);
    if (vessel) this.vesselInfo?.prefetch(vessel.mmsi, vessel.imo);

    for (const event of events) {
      void this.dispatch(event);
    }
  }

  private async dispatch(passage: PassageEvent): Promise<void> {
    const info = await this.vesselInfo?.get(passage.mmsi, passage.imo, VESSEL_INFO_WAIT_MS);
    const event: PassageEvent = info ? { ...passage, vesselInfo: info } : passage;

    console.log(
      `[notifier] Passage ${event.predicted ? "predicted" : "observed"} at ${event.watchPoint.name}: ${event.name} (MMSI: ${event.mmsi}) ${event.direction} at ${event.speed.toFixed(1)} kn`
    );

    const report = (channel: string) => (success: boolean) => {
      if (success) {
        console.log(`[notifier] ${channel} sent for ${event.name}`);
      } else {
        console.error(`[notifier] Failed to send ${channel} for ${event.name}`);
      }
    };

    this.ntfy?.sendPassageNotification(event).then(report("ntfy notification"));
    this.webhook?.sendPassage(event).then(report("webhook"));
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
      this.vesselInfo?.prune();
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
