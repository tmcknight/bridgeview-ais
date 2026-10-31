import { EventEmitter } from "node:events";
import { wantsLiveActivity } from "./push-devices.js";

// Bridge alerts for the iOS app: when a ship's ETA at the bridge falls to 10
// minutes, every registered iPhone whose settings match gets told, either with a
// Live Activity counting down to the passage (started by push-to-start on a
// broadcast channel opened for that ship) or a normal notification. The Live
// Activity is updated as the ETA moves and ended when the ship goes under.

// Alert when the ETA first falls to this or less (minutes)...
export const ALERT_MAX_ETA_MINUTES = 10;
// ...but not when it's already this close: too late to get to the river
export const ALERT_MIN_ETA_MINUTES = 3;
// Slower ships give jumpy ETAs (a ship manoeuvring at a dock)
export const ALERT_MIN_SPEED_KN = 2;
// One alert per ship in this long
export const ALERT_COOLDOWN_MS = 45 * 60_000;
// Give up on a ship that hasn't gone under in this long, ending its Live Activity
export const ACTIVITY_TIMEOUT_MS = 30 * 60_000;
// Live Activity updates at most this often, and only when the ETA moves this much
export const UPDATE_INTERVAL_MS = 60_000;
export const UPDATE_MIN_ETA_CHANGE_MS = 60_000;
// An ended Live Activity stays on the lock screen this long
export const DISMISS_AFTER_MS = 15 * 60_000;
// Delete a channel this long after its last message, once devices have it
const CHANNEL_DELETE_DELAY_MS = 20 * 60_000;
// A countdown this far past its ETA with no update is shown as out of date
const STALE_AFTER_ETA_MS = 5 * 60_000;
// Pushes sent at once
const SEND_CONCURRENCY = 20;

// Swift's Date encodes as seconds since 2001-01-01, and the system decodes Live
// Activity content with the default strategy
const SWIFT_REFERENCE_DATE_MS = Date.UTC(2001, 0, 1);

export function swiftDate(ms) {
  return (ms - SWIFT_REFERENCE_DATE_MS) / 1000;
}

function titleCase(text) {
  return text.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// "Upbound · Cargo · 225 m"
function subtitleFor(ship) {
  return [
    ship.approach.direction === "upbound" ? "Upbound" : "Downbound",
    ship.shipTypeName,
    ship.length ? `${ship.length} m` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function alertContent(ship) {
  const minutes = Math.max(1, Math.round(ship.approach.etaMinutes));
  const heading = ship.destination ? `Heading for ${titleCase(ship.destination)}.` : "Heading for the Blue Water Bridge.";
  return {
    title: `${ship.name} in ~${minutes} min`,
    subtitle: subtitleFor(ship),
    body: ship.cargo ? `${heading} ${ship.cargo}.` : heading,
  };
}

export function alertPayload(ship) {
  return {
    aps: {
      alert: alertContent(ship),
      sound: "default",
      "thread-id": "bridge",
      "interruption-level": "time-sensitive",
      "relevance-score": 1,
    },
    mmsi: ship.mmsi,
  };
}

function contentState(ship, phase, t) {
  const etaMs = ship.approach ? Date.parse(ship.approach.eta) : t;
  return {
    eta: swiftDate(etaMs),
    distanceNM: ship.approach?.distanceNM ?? 0,
    sog: ship.position?.sog ?? 0,
    phase,
  };
}

export function activityAttributes(ship) {
  return {
    mmsi: ship.mmsi,
    name: ship.name,
    direction: ship.approach.direction,
    ...(ship.shipTypeName && { shipTypeName: ship.shipTypeName }),
    ...(ship.length && { length: ship.length }),
    ...(ship.destination && { destination: ship.destination }),
  };
}

export function pushToStartPayload(ship, channelId, t) {
  const { title, subtitle, body } = alertContent(ship);
  return {
    aps: {
      timestamp: Math.floor(t / 1000),
      event: "start",
      "input-push-channel": channelId,
      "attributes-type": "ShipApproachAttributes",
      attributes: activityAttributes(ship),
      "content-state": contentState(ship, "approaching", t),
      "stale-date": Math.floor((Date.parse(ship.approach.eta) + STALE_AFTER_ETA_MS) / 1000),
      alert: { title, body: `${subtitle}. ${body}`, sound: "default" },
    },
  };
}

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += SEND_CONCURRENCY) {
    await Promise.allSettled(items.slice(i, i + SEND_CONCURRENCY).map(fn));
  }
}

// `ship(mmsi)` gives the app's view of a ship (bridge-api.js); feed it position
// reports with handleMessage and ship log entries with handleShipLogEntry.
// Emits "alert" (ship, { notified, liveActivities }) for each alert sent.
export function createApproachAlerts({ apns, pushDevices, ship, logger, now = Date.now }) {
  const emitter = new EventEmitter();
  const alertedAt = new Map(); // mmsi -> ms
  const active = new Map(); // mmsi -> { channels: [{ channelId, environment }], startedAt, lastUpdateAt, lastEtaMs, timeout }
  const pendingDeletes = new Set();

  function deleteChannelLater(channel) {
    const timer = setTimeout(() => {
      pendingDeletes.delete(timer);
      apns
        .deleteChannel(channel)
        .catch((err) => logger?.warn(`[alerts] could not delete channel: ${err.message}`))
        .finally(() => pushDevices.removeChannel(channel));
    }, CHANNEL_DELETE_DELAY_MS);
    timer.unref?.();
    pendingDeletes.add(timer);
  }

  async function broadcastAll(channels, payload, priority, expiresAt) {
    await Promise.allSettled(
      channels.map((channel) =>
        apns
          .broadcast({ ...channel, payload, priority, expiresAt })
          .catch((err) => logger?.warn(`[alerts] broadcast failed: ${err.message}`))
      )
    );
  }

  function endActivity(mmsi, phase, current) {
    const activity = active.get(mmsi);
    if (!activity) return;
    active.delete(mmsi);
    clearTimeout(activity.timeout);
    const t = now();
    const state = current ? contentState(current, phase, t) : { eta: swiftDate(t), distanceNM: 0, sog: 0, phase };
    const payload = {
      aps: {
        timestamp: Math.floor(t / 1000),
        event: "end",
        "content-state": state,
        "dismissal-date": Math.floor((t + DISMISS_AFTER_MS) / 1000),
      },
    };
    logger?.log(`[alerts] ending Live Activity for ${mmsi} (${phase})`);
    void broadcastAll(activity.channels, payload, 10, t + DISMISS_AFTER_MS).finally(() => {
      for (const channel of activity.channels) deleteChannelLater(channel);
    });
  }

  function updateActivity(current) {
    const activity = active.get(current.mmsi);
    if (!activity || !current.approach) return;
    const t = now();
    const etaMs = Date.parse(current.approach.eta);
    if (t - activity.lastUpdateAt < UPDATE_INTERVAL_MS) return;
    if (Math.abs(etaMs - activity.lastEtaMs) < UPDATE_MIN_ETA_CHANGE_MS) return;
    activity.lastUpdateAt = t;
    activity.lastEtaMs = etaMs;
    const payload = {
      aps: {
        timestamp: Math.floor(t / 1000),
        event: "update",
        "content-state": contentState(current, "approaching", t),
        "stale-date": Math.floor((etaMs + STALE_AFTER_ETA_MS) / 1000),
      },
    };
    // Low priority: doesn't count against the device's budget
    void broadcastAll(activity.channels, payload, 5, etaMs + STALE_AFTER_ETA_MS);
  }

  async function openChannel(environment, mmsi) {
    try {
      const channelId = await apns.createChannel({ environment });
      const channel = { channelId, environment };
      pushDevices.addChannel({ ...channel, mmsi });
      return channel;
    } catch (err) {
      logger?.warn(`[alerts] could not open a ${environment} Live Activity channel: ${err.message}`);
      return null;
    }
  }

  async function sendAlert(current) {
    const t = now();
    const devices = pushDevices.matching({
      mmsi: current.mmsi,
      category: current.category,
      length: current.length,
      direction: current.approach.direction,
    });
    const wantsActivity = devices.filter((d) => wantsLiveActivity(d, current.mmsi));
    const environments = [...new Set(wantsActivity.map((d) => d.environment))];
    const channels = new Map();
    for (const environment of environments) {
      const channel = await openChannel(environment, current.mmsi);
      if (channel) channels.set(environment, channel);
    }
    if (channels.size > 0) {
      const timeout = setTimeout(() => endActivity(current.mmsi, "lost"), ACTIVITY_TIMEOUT_MS);
      timeout.unref?.();
      active.set(current.mmsi, {
        channels: [...channels.values()],
        startedAt: t,
        lastUpdateAt: t,
        lastEtaMs: Date.parse(current.approach.eta),
        timeout,
      });
    }

    const expiresAt = Date.parse(current.approach.eta);
    let notified = 0;
    let liveActivities = 0;
    await inBatches(devices, async (device) => {
      const channel = wantsLiveActivity(device, current.mmsi) && channels.get(device.environment);
      try {
        if (channel) {
          await apns.sendLiveActivity({
            token: device.pushToStartToken,
            environment: device.environment,
            payload: pushToStartPayload(current, channel.channelId, t),
            expiresAt,
          });
          liveActivities++;
        } else {
          await apns.sendAlert({
            deviceToken: device.token,
            environment: device.environment,
            payload: alertPayload(current),
            collapseId: `ship-${current.mmsi}`,
            expiresAt,
          });
          notified++;
        }
      } catch (err) {
        if (err.isBadToken) {
          if (channel) pushDevices.clearPushToStartToken(device.pushToStartToken);
          else pushDevices.remove(device.token);
        } else {
          logger?.warn(`[alerts] push to a device failed: ${err.message}`);
        }
      }
    });
    logger?.log(
      `[alerts] ${current.name} ~${Math.round(current.approach.etaMinutes)} min out: ${notified} notified, ${liveActivities} Live Activities`
    );
    emitter.emit("alert", current, { notified, liveActivities });
  }

  function handleMessage(message) {
    if (message?.MessageType !== "PositionReport" || message.MetaData?.AisClass === "B") return;
    const mmsi = message.MetaData.MMSI;
    if (active.has(mmsi)) {
      const current = ship(mmsi);
      if (current) updateActivity(current);
      return;
    }
    if (now() - (alertedAt.get(mmsi) ?? -Infinity) < ALERT_COOLDOWN_MS) return;
    const current = ship(mmsi);
    const approach = current?.approach;
    if (!approach || current.classB) return;
    if (approach.etaMinutes > ALERT_MAX_ETA_MINUTES || approach.etaMinutes < ALERT_MIN_ETA_MINUTES) return;
    if (!(current.position.sog >= ALERT_MIN_SPEED_KN)) return;
    alertedAt.set(mmsi, now());
    sendAlert(current).catch((err) => logger?.error(`[alerts] alert for ${mmsi} failed: ${err.message}`));
  }

  // A ship log entry changed; if it's a new passage, end that ship's Live Activity
  function handleShipLogEntry(entry) {
    const activity = active.get(entry.mmsi);
    if (!activity) return;
    if (Date.parse(entry.passages[0]?.time) < activity.startedAt) return;
    endActivity(entry.mmsi, "passed", ship(entry.mmsi));
  }

  // End and delete channels left open by a previous run
  async function cleanUp() {
    const t = now();
    for (const { channelId, environment } of pushDevices.channels()) {
      const channel = { channelId, environment };
      const payload = {
        aps: {
          timestamp: Math.floor(t / 1000),
          event: "end",
          "content-state": { eta: swiftDate(t), distanceNM: 0, sog: 0, phase: "lost" },
          "dismissal-date": Math.floor(t / 1000),
        },
      };
      await apns.broadcast({ ...channel, payload, priority: 10, expiresAt: t + DISMISS_AFTER_MS }).catch(() => {});
      await apns.deleteChannel(channel).catch(() => {});
      pushDevices.removeChannel(channel);
    }
  }

  function stop() {
    for (const activity of active.values()) clearTimeout(activity.timeout);
    for (const timer of pendingDeletes) clearTimeout(timer);
  }

  return Object.assign(emitter, { handleMessage, handleShipLogEntry, cleanUp, stop });
}
