import { VesselNotifier } from "./notifier.js";
import { parseWatchPoints } from "./watch-points.js";
import { CLOSE_APPROACH_DISTANCE_NM } from "./geo.js";
import type { NotifierConfig } from "./types.js";

// A number setting from the environment. A typo would otherwise become NaN, which
// every comparison lets through: alerts for any ship nearby, with no cooldown.
function numberSetting(name: string, { min }: { min: number }): number | undefined {
  const text = process.env[name];
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a number of at least ${min}, got "${text}"`);
  }
  return value;
}

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
  const thresholdNM = numberSetting("BRIDGE_THRESHOLD_NM", { min: 0.01 });
  if (thresholdNM !== undefined) config.bridgeThresholdNM = thresholdNM;
  const cooldownMs = numberSetting("NOTIFICATION_COOLDOWN_MS", { min: 0 });
  if (cooldownMs !== undefined) config.notificationCooldownMs = cooldownMs;
  const horizonSeconds = numberSetting("PREDICTION_HORIZON_SECONDS", { min: 0 });
  if (horizonSeconds !== undefined) config.predictionHorizonSeconds = horizonSeconds;
  const leadSeconds = numberSetting("PREDICTION_LEAD_SECONDS", { min: 0 });
  if (leadSeconds !== undefined) config.predictionLeadSeconds = leadSeconds;
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
