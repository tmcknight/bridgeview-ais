import { VesselNotifier } from "./notifier.js";
import type { NotifierConfig } from "./types.js";

function loadConfig(): Partial<NotifierConfig> {
  const config: Partial<NotifierConfig> = {};

  if (process.env.NTFY_SERVER) config.ntfyServer = process.env.NTFY_SERVER;
  if (process.env.NTFY_TOPIC) config.ntfyTopic = process.env.NTFY_TOPIC;
  if (process.env.NTFY_TOKEN) config.ntfyToken = process.env.NTFY_TOKEN;
  if (process.env.WS_PROXY_URL) config.wsProxyUrl = process.env.WS_PROXY_URL;
  if (process.env.WS_AUTH_TOKEN) config.wsAuthToken = process.env.WS_AUTH_TOKEN;
  if (process.env.BRIDGE_THRESHOLD_NM)
    config.bridgeThresholdNM = parseFloat(process.env.BRIDGE_THRESHOLD_NM);
  if (process.env.NOTIFICATION_COOLDOWN_MS)
    config.notificationCooldownMs = parseInt(
      process.env.NOTIFICATION_COOLDOWN_MS,
      10
    );

  return config;
}

const config = loadConfig();

if (!config.ntfyTopic) {
  console.error(
    "[notifier] NTFY_TOPIC environment variable is required"
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
