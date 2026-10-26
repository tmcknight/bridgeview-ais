import { VesselNotifier } from "./notifier.js";
import { parseWatchPoints } from "./watch-points.js";
import { CLOSE_APPROACH_DISTANCE_NM } from "./geo.js";
import type { NotifierConfig } from "./types.js";

function loadConfig(): Partial<NotifierConfig> {
  const config: Partial<NotifierConfig> = {};

  if (process.env.NTFY_SERVER) config.ntfyServer = process.env.NTFY_SERVER;
  if (process.env.NTFY_TOPIC) config.ntfyTopic = process.env.NTFY_TOPIC;
  if (process.env.NTFY_TOKEN) config.ntfyToken = process.env.NTFY_TOKEN;
  if (process.env.WS_PROXY_URL) config.wsProxyUrl = process.env.WS_PROXY_URL;
  if (process.env.WS_AUTH_TOKEN) config.wsAuthToken = process.env.WS_AUTH_TOKEN;
  if (process.env.WEBHOOK_URL) config.webhookUrl = process.env.WEBHOOK_URL;
  if (process.env.WEBHOOK_SECRET) config.webhookSecret = process.env.WEBHOOK_SECRET;
  if (process.env.VESSEL_INFO_LOOKUP)
    config.vesselInfoLookup = process.env.VESSEL_INFO_LOOKUP !== "false";
  if (process.env.BRIDGE_THRESHOLD_NM)
    config.bridgeThresholdNM = parseFloat(process.env.BRIDGE_THRESHOLD_NM);
  if (process.env.NOTIFICATION_COOLDOWN_MS)
    config.notificationCooldownMs = parseInt(
      process.env.NOTIFICATION_COOLDOWN_MS,
      10
    );
  if (process.env.PREDICTION_HORIZON_SECONDS)
    config.predictionHorizonSeconds = parseInt(process.env.PREDICTION_HORIZON_SECONDS, 10);
  if (process.env.PREDICTION_LEAD_SECONDS)
    config.predictionLeadSeconds = parseInt(process.env.PREDICTION_LEAD_SECONDS, 10);
  if (process.env.WATCH_POINTS)
    config.watchPoints = parseWatchPoints(
      process.env.WATCH_POINTS,
      config.bridgeThresholdNM ?? CLOSE_APPROACH_DISTANCE_NM
    );

  return config;
}

let config: Partial<NotifierConfig>;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[notifier] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

if (!config.ntfyTopic && !config.webhookUrl) {
  console.error(
    "[notifier] Set NTFY_TOPIC and/or WEBHOOK_URL so passages have somewhere to go"
  );
  process.exit(1);
}

const notifier = new VesselNotifier(config);
notifier.start();

// Graceful shutdown
function shutdown() {
  console.log("[notifier] Shutting down...");
  notifier.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
