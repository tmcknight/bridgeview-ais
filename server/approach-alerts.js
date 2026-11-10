import { EventEmitter } from "node:events";
import { wantsLiveActivity } from "./push-devices.js";

// Bridge alerts for the iOS and Android apps: when a ship's ETA at the bridge falls
// to 10 minutes, every registered phone whose settings match gets told, either with
// a Live Activity counting down to the passage (started by push-to-start on a
// broadcast channel opened for that ship) or a normal notification. The Live
// Activity is updated as the ETA moves and ended when the ship goes under.
// Android phones get the same through FCM data messages: a plain alert, or a live
// countdown (start, update, end) sent to each phone that wants one.
// A ship the user follows (Live Activity turned on for that ship) gets its Live
// Activity from FOLLOW_MAX_ETA_MINUTES out instead of waiting for the alert.
// Activities under way are saved, so a restart carries them on.

// Alert when the ETA first falls to this or less (minutes)...
export const ALERT_MAX_ETA_MINUTES = 10;
// ...but not when it's already this close: too late to get to the river
export const ALERT_MIN_ETA_MINUTES = 3;
// Slower ships give jumpy ETAs (a ship manoeuvring at a dock)
export const ALERT_MIN_SPEED_KN = 2;
// One alert per ship in this long
export const ALERT_COOLDOWN_MS = 45 * 60_000;
// Ships the user follows get their Live Activity from this far out (minutes)
export const FOLLOW_MAX_ETA_MINUTES = 60;
// Look for new followers of a ship at most this often
const FOLLOW_CHECK_INTERVAL_MS = 60_000;
// Give up on a ship that hasn't gone under in this long after its Live Activity
// started, or this long after its latest ETA if that's later, ending it as lost
export const ACTIVITY_TIMEOUT_MS = 30 * 60_000;
const PAST_ETA_TIMEOUT_MS = 20 * 60_000;
// A ship no longer heading for the bridge (stopped, turned away) for this long
// is lost...
export const LOST_AFTER_MS = 2 * 60_000;
// ...unless it was last this close: it's likely going under, and the ship log
// ends it as passed
export const LOST_MIN_DISTANCE_NM = 1;
// Live Activity updates at most this often, and only when the ETA or the distance
// moves this much
export const UPDATE_INTERVAL_MS = 60_000;
export const UPDATE_MIN_ETA_CHANGE_MS = 60_000;
export const UPDATE_MIN_DISTANCE_CHANGE_NM = 0.25;
// In the last few minutes, more often and for smaller changes
export const FINAL_APPROACH_MS = 3 * 60_000;
export const FINAL_UPDATE_INTERVAL_MS = 20_000;
const FINAL_MIN_ETA_CHANGE_MS = 15_000;
const FINAL_MIN_DISTANCE_CHANGE_NM = 0.1;
// One high-priority update when the ship gets this close
export const ARRIVING_NM = 0.3;
// The ship coming up next is shown on a passed Live Activity if it's this close (minutes)
const NEXT_SHIP_MAX_ETA_MINUTES = 90;
// An ended Live Activity stays on the lock screen this long
export const DISMISS_AFTER_MS = 15 * 60_000;
// Delete a channel this long after its last message, once devices have it
const CHANNEL_DELETE_DELAY_MS = 20 * 60_000;
// A countdown this far past its ETA with no update is shown as out of date
const STALE_AFTER_ETA_MS = 5 * 60_000;
// Pushes sent at once
const SEND_CONCURRENCY = 20;
// FCM messages live at least this long, even when the ETA is already here
const FCM_MIN_TTL_S = 5;

// Swift's Date encodes as seconds since 2001-01-01, and the system decodes Live
// Activity content with the default strategy
const SWIFT_REFERENCE_DATE_MS = Date.UTC(2001, 0, 1);

export function swiftDate(ms) {
  return (ms - SWIFT_REFERENCE_DATE_MS) / 1000;
}

function titleCase(text) {
  return text.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

const FEET_PER_METRE = 3.28084;
const feetFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// A length in metres as the device's unit (`lengthUnit` "m" or "ft"): "225 m", "1,013 ft"
export function formatLength(metres, unit = "m") {
  return unit === "ft" ? `${feetFormat.format(Math.round(metres * FEET_PER_METRE))} ft` : `${metres} m`;
}

// "Upbound · Cargo · 225 m"
function subtitleFor(ship, unit) {
  return [
    ship.approach.direction === "upbound" ? "Upbound" : "Downbound",
    ship.shipTypeName,
    ship.length ? formatLength(ship.length, unit) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

// `unit` is the device's `lengthUnit`
export function alertContent(ship, unit = "m") {
  const minutes = Math.max(1, Math.round(ship.approach.etaMinutes));
  const heading = ship.destination ? `Heading for ${titleCase(ship.destination)}.` : "Heading for the Blue Water Bridge.";
  return {
    title: `${ship.name} in ~${minutes} min`,
    subtitle: subtitleFor(ship, unit),
    body: ship.cargo ? `${heading} ${ship.cargo}.` : heading,
  };
}

export function alertPayload(ship, unit = "m") {
  return {
    aps: {
      alert: alertContent(ship, unit),
      sound: "default",
      "thread-id": "bridge",
      "interruption-level": "time-sensitive",
      "relevance-score": 1,
    },
    mmsi: ship.mmsi,
  };
}

// `ending` is { passedAt (ms), next: { name, eta (ISO) } }, each optional, for a
// ship gone under
function contentState(ship, phase, t, ending = {}) {
  const etaMs = ship?.approach ? Date.parse(ship.approach.eta) : t;
  return {
    eta: swiftDate(etaMs),
    distanceNM: ship?.approach?.distanceNM ?? 0,
    sog: ship?.position?.sog ?? 0,
    phase,
    updatedAt: swiftDate(t),
    ...(ending.passedAt !== undefined && { passedAt: swiftDate(ending.passedAt) }),
    ...(ending.next && { nextName: ending.next.name, nextEta: swiftDate(Date.parse(ending.next.eta)) }),
  };
}

// Which of several Live Activities iOS puts in the Dynamic Island: the soonest
export function relevanceScore(etaMs, t) {
  return Math.min(100, Math.max(1, Math.round(100 - (etaMs - t) / 60_000)));
}

// `startedAt` (ms) is when the countdown began, for its progress bar
export function activityAttributes(ship, startedAt) {
  return {
    mmsi: ship.mmsi,
    name: ship.name,
    direction: ship.approach.direction,
    ...(ship.shipTypeName && { shipTypeName: ship.shipTypeName }),
    ...(ship.length && { length: ship.length }),
    ...(ship.destination && { destination: ship.destination }),
    ...(startedAt !== undefined && { startedAt: swiftDate(startedAt) }),
  };
}

// Sent to one device's push-to-start token, so its alert text is in that device's unit
export function pushToStartPayload(ship, channelId, t, unit = "m") {
  const { title, subtitle, body } = alertContent(ship, unit);
  const etaMs = Date.parse(ship.approach.eta);
  return {
    aps: {
      timestamp: Math.floor(t / 1000),
      event: "start",
      "input-push-channel": channelId,
      "attributes-type": "ShipApproachAttributes",
      attributes: activityAttributes(ship, t),
      "content-state": contentState(ship, "approaching", t),
      "stale-date": Math.floor((etaMs + STALE_AFTER_ETA_MS) / 1000),
      "relevance-score": relevanceScore(etaMs, t),
      alert: { title, body: `${subtitle}. ${body}`, sound: "default" },
    },
  };
}

// FCM data values must all be strings; absent ones are left out
function stringValues(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// An FCM message for one Android device, kept until `expiresAt`
function fcmMessage(token, data, expiresAt, t, extra = {}) {
  const ttl = Math.max(FCM_MIN_TTL_S, Math.ceil((expiresAt - t) / 1000));
  return { token, data: stringValues(data), android: { priority: "HIGH", ttl: `${ttl}s`, ...extra } };
}

// Android: the alert's notification, built by the app
export function fcmAlertMessage(token, ship, t, unit = "m") {
  return fcmMessage(
    token,
    { type: "alert", mmsi: ship.mmsi, ...alertContent(ship, unit) },
    Date.parse(ship.approach.eta),
    t,
    { collapse_key: `ship-${ship.mmsi}` }
  );
}

// Android live countdown data: the activity's fixed details (its Swift start
// date made ISO) and where the ship is
function activityData(event, attributes, current, phase, t) {
  const etaMs = current?.approach ? Date.parse(current.approach.eta) : t;
  const { startedAt, ...fixed } = attributes;
  return {
    type: "activity",
    event,
    ...fixed,
    ...(startedAt !== undefined && { startedAt: iso(Math.round(startedAt * 1000) + SWIFT_REFERENCE_DATE_MS) }),
    eta: iso(etaMs),
    distanceNM: current?.approach?.distanceNM ?? 0,
    sog: current?.position?.sog ?? 0,
    phase,
  };
}

export function fcmActivityStartMessage(token, ship, t, unit = "m") {
  const { title, subtitle, body } = alertContent(ship, unit);
  const etaMs = Date.parse(ship.approach.eta);
  return fcmMessage(
    token,
    {
      ...activityData("start", activityAttributes(ship, t), ship, "approaching", t),
      title,
      body: `${subtitle}. ${body}`,
      staleAt: iso(etaMs + STALE_AFTER_ETA_MS),
    },
    etaMs,
    t
  );
}

export function fcmActivityUpdateMessage(token, attributes, current, t) {
  const etaMs = Date.parse(current.approach.eta);
  return fcmMessage(
    token,
    { ...activityData("update", attributes, current, "approaching", t), staleAt: iso(etaMs + STALE_AFTER_ETA_MS) },
    etaMs + STALE_AFTER_ETA_MS,
    t
  );
}

// `ending` is { passedAt, next } as for the Live Activity
export function fcmActivityEndMessage(token, attributes, current, phase, t, ending = {}) {
  return fcmMessage(
    token,
    {
      ...activityData("end", attributes, current, phase, t),
      dismissAt: iso(t + DISMISS_AFTER_MS),
      ...(ending.passedAt !== undefined && { passedAt: iso(ending.passedAt) }),
      ...(ending.next && { nextName: ending.next.name, nextEta: ending.next.eta }),
    },
    t + DISMISS_AFTER_MS,
    t
  );
}

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += SEND_CONCURRENCY) {
    await Promise.allSettled(items.slice(i, i + SEND_CONCURRENCY).map(fn));
  }
}

// `ship(mmsi)` gives the app's view of a ship (bridge-api.js); feed it position
// reports with handleMessage and ship log entries with handleShipLogEntry.
// `upcoming()` gives the ships coming up, soonest first, for the "next" ship shown
// when a Live Activity ends with its ship gone under.
// `apns` and `fcm` may each be null; devices on a platform with no client are skipped.
// Emits "alert" (ship, { notified, liveActivities }) for each alert sent (both
// platforms counted).
export function createApproachAlerts({
  apns = null,
  fcm = null,
  pushDevices,
  ship,
  upcoming = () => [],
  logger,
  now = Date.now,
}) {
  const emitter = new EventEmitter();
  const alertedAt = new Map(); // mmsi -> ms
  const followCheckedAt = new Map(); // mmsi -> ms
  // mmsi -> { mmsi, channels: [{ channelId, environment }], fcmTokens: Set,
  //           started: Set (tokens of the devices it was started on), attributes,
  //           startedAt, lastUpdateAt, lastEtaMs, lastDistanceNM, arriving,
  //           alertedAt, lostSince, timeout }
  const active = new Map();
  // Ships with an alert or a start on its way
  const sending = new Set();
  const pendingDeletes = new Set();

  function deleteChannelLater(channel) {
    const timer = setTimeout(() => {
      pendingDeletes.delete(timer);
      apns
        .deleteChannel(channel)
        .catch((err) => logger?.warn(`[alerts] could not delete channel: ${err.message}`))
        .then(() => pushDevices.removeChannel(channel))
        .catch((err) => logger?.warn(`[alerts] could not forget channel: ${err.message}`));
    }, CHANNEL_DELETE_DELAY_MS);
    timer.unref?.();
    pendingDeletes.add(timer);
  }

  // Kept in the database, so a restart carries the activity on
  function save(activity) {
    if (active.get(activity.mmsi) !== activity) return;
    pushDevices.saveActivity(activity.mmsi, {
      channels: activity.channels,
      fcmTokens: [...activity.fcmTokens],
      started: [...activity.started],
      attributes: activity.attributes,
      startedAt: activity.startedAt,
      lastUpdateAt: activity.lastUpdateAt,
      lastEtaMs: activity.lastEtaMs,
      lastDistanceNM: activity.lastDistanceNM,
      arriving: activity.arriving,
      alertedAt: activity.alertedAt,
    });
  }

  function restore(mmsi, state) {
    if (!state || !Array.isArray(state.channels) || !Number.isFinite(state.startedAt)) return null;
    return {
      mmsi,
      // Only what this run can still reach
      channels: apns ? state.channels : [],
      fcmTokens: new Set(fcm ? (state.fcmTokens ?? []) : []),
      started: new Set(state.started ?? []),
      attributes: state.attributes,
      startedAt: state.startedAt,
      lastUpdateAt: state.lastUpdateAt ?? state.startedAt,
      lastEtaMs: state.lastEtaMs ?? state.startedAt,
      lastDistanceNM: state.lastDistanceNM ?? 0,
      arriving: Boolean(state.arriving),
      alertedAt: state.alertedAt,
      lostSince: undefined,
      timeout: undefined,
    };
  }

  // When to give up on the ship: a while after the start, or after its ETA if later
  function deadline(activity) {
    return Math.max(activity.startedAt + ACTIVITY_TIMEOUT_MS, activity.lastEtaMs + PAST_ETA_TIMEOUT_MS);
  }

  function scheduleTimeout(activity) {
    clearTimeout(activity.timeout);
    activity.timeout = setTimeout(() => {
      try {
        endActivity(activity.mmsi, "lost");
      } catch (err) {
        logger?.error(`[alerts] ending the activity for ${activity.mmsi} failed: ${err.message}`);
      }
    }, Math.max(0, deadline(activity) - now()));
    activity.timeout.unref?.();
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

  // Android live countdown messages to every phone following this activity; a
  // phone FCM says is gone is removed
  async function sendFcmAll(activity, messageFor) {
    const before = activity.fcmTokens.size;
    await inBatches([...activity.fcmTokens], async (token) => {
      try {
        await fcm.send(messageFor(token));
      } catch (err) {
        if (err.isBadToken) {
          activity.fcmTokens.delete(token);
          pushDevices.remove(token);
        } else {
          logger?.warn(`[alerts] FCM message failed: ${err.message}`);
        }
      }
    });
    if (activity.fcmTokens.size !== before) save(activity);
  }

  // The ship coming up after this one, if any is close: { name, eta }
  function nextShip(mmsi) {
    try {
      const next = upcoming().find(
        (s) =>
          s.mmsi !== mmsi &&
          s.approach?.etaMinutes > 0 &&
          s.approach.etaMinutes <= NEXT_SHIP_MAX_ETA_MINUTES
      );
      return next && { name: next.name, eta: next.approach.eta };
    } catch (err) {
      logger?.warn(`[alerts] could not find the next ship: ${err.message}`);
      return undefined;
    }
  }

  // `ending` is { passedAt, next } for a ship gone under
  function endActivity(mmsi, phase, current, ending = {}) {
    const activity = active.get(mmsi);
    if (!activity) return;
    active.delete(mmsi);
    clearTimeout(activity.timeout);
    pushDevices.removeActivity(mmsi);
    const t = now();
    logger?.log(`[alerts] ending Live Activity for ${mmsi} (${phase})`);
    if (activity.fcmTokens.size > 0) {
      void sendFcmAll(activity, (token) => fcmActivityEndMessage(token, activity.attributes, current, phase, t, ending));
    }
    if (activity.channels.length === 0) return;
    const payload = {
      aps: {
        timestamp: Math.floor(t / 1000),
        event: "end",
        "content-state": contentState(current, phase, t, ending),
        "dismissal-date": Math.floor((t + DISMISS_AFTER_MS) / 1000),
      },
    };
    void broadcastAll(activity.channels, payload, 10, t + DISMISS_AFTER_MS).finally(() => {
      for (const channel of activity.channels) deleteChannelLater(channel);
    });
  }

  function updateActivity(activity, current) {
    const t = now();
    if (!current?.approach) {
      // Stopped or turned away; near the bridge it's more likely going under
      activity.lostSince ??= t;
      if (t - activity.lostSince >= LOST_AFTER_MS && activity.lastDistanceNM > LOST_MIN_DISTANCE_NM) {
        endActivity(activity.mmsi, "lost", current);
      }
      return;
    }
    activity.lostSince = undefined;
    const etaMs = Date.parse(current.approach.eta);
    const distanceNM = current.approach.distanceNM;
    const arriving = !activity.arriving && distanceNM <= ARRIVING_NM;
    if (!arriving) {
      const final = etaMs - t <= FINAL_APPROACH_MS;
      if (t - activity.lastUpdateAt < (final ? FINAL_UPDATE_INTERVAL_MS : UPDATE_INTERVAL_MS)) return;
      const etaMoved = Math.abs(etaMs - activity.lastEtaMs) >= (final ? FINAL_MIN_ETA_CHANGE_MS : UPDATE_MIN_ETA_CHANGE_MS);
      const distanceMoved =
        Math.abs(distanceNM - activity.lastDistanceNM) >=
        (final ? FINAL_MIN_DISTANCE_CHANGE_NM : UPDATE_MIN_DISTANCE_CHANGE_NM);
      if (!etaMoved && !distanceMoved) return;
    }
    activity.lastUpdateAt = t;
    activity.lastEtaMs = etaMs;
    activity.lastDistanceNM = distanceNM;
    if (arriving) activity.arriving = true;
    const payload = {
      aps: {
        timestamp: Math.floor(t / 1000),
        event: "update",
        "content-state": contentState(current, "approaching", t),
        "stale-date": Math.floor((etaMs + STALE_AFTER_ETA_MS) / 1000),
        "relevance-score": relevanceScore(etaMs, t),
      },
    };
    // Low priority doesn't count against the device's budget; the one update as
    // the ship reaches the bridge is worth spending it on
    if (activity.channels.length > 0) {
      void broadcastAll(activity.channels, payload, arriving ? 10 : 5, etaMs + STALE_AFTER_ETA_MS);
    }
    if (activity.fcmTokens.size > 0) {
      void sendFcmAll(activity, (token) => fcmActivityUpdateMessage(token, activity.attributes, current, t));
    }
    scheduleTimeout(activity);
    save(activity);
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

  // The alert for a ship: a Live Activity (or Android countdown) for devices that
  // want one, a notification for the rest. With `followersOnly`, only Live
  // Activities, for devices following this ship that don't have one yet.
  async function sendAlert(current, { followersOnly = false } = {}) {
    const t = now();
    const mmsi = current.mmsi;
    let activity = active.get(mmsi);
    const candidates = (
      followersOnly
        ? pushDevices.followers(mmsi)
        : pushDevices.matching({
            mmsi,
            category: current.category,
            length: current.length,
            direction: current.approach.direction,
          })
    ).filter((d) => !activity?.started.has(d.token));
    // Only devices whose platform has a client: never APNs an FCM token or vice versa
    let devices = apns ? candidates.filter((d) => d.platform !== "android") : [];
    let androidDevices = fcm ? candidates.filter((d) => d.platform === "android") : [];
    if (followersOnly) {
      // Their notification, if they want one, comes with everyone else's
      devices = devices.filter((d) => wantsLiveActivity(d, mmsi));
      androidDevices = androidDevices.filter((d) => wantsLiveActivity(d, mmsi));
      if (devices.length === 0 && androidDevices.length === 0) return;
    }
    const wantsActivity = devices.filter((d) => wantsLiveActivity(d, mmsi));
    const androidActivities = androidDevices.filter((d) => wantsLiveActivity(d, mmsi));

    // One channel per environment for the ship, kept for later starts
    const channels = new Map((activity?.channels ?? []).map((c) => [c.environment, c]));
    for (const environment of new Set(wantsActivity.map((d) => d.environment))) {
      if (channels.has(environment)) continue;
      const channel = await openChannel(environment, mmsi);
      if (channel) channels.set(environment, channel);
    }
    // It may have ended while the channels opened
    activity = active.get(mmsi);
    if (!activity && (channels.size > 0 || androidActivities.length > 0)) {
      activity = {
        mmsi,
        channels: [],
        fcmTokens: new Set(),
        started: new Set(),
        attributes: activityAttributes(current, t),
        startedAt: t,
        lastUpdateAt: t,
        lastEtaMs: Date.parse(current.approach.eta),
        lastDistanceNM: current.approach.distanceNM,
        arriving: false,
        alertedAt: undefined,
        lostSince: undefined,
        timeout: undefined,
      };
      active.set(mmsi, activity);
      scheduleTimeout(activity);
    }
    if (activity) {
      activity.channels = [...channels.values()];
      if (!followersOnly) activity.alertedAt = t;
    }

    const expiresAt = Date.parse(current.approach.eta);
    let notified = 0;
    let liveActivities = 0;
    await inBatches(devices, async (device) => {
      const channel = wantsLiveActivity(device, mmsi) && channels.get(device.environment);
      try {
        if (channel) {
          await apns.sendLiveActivity({
            token: device.pushToStartToken,
            environment: device.environment,
            payload: pushToStartPayload(current, channel.channelId, t, device.lengthUnit),
            expiresAt,
          });
          activity?.started.add(device.token);
          liveActivities++;
        } else {
          await apns.sendAlert({
            deviceToken: device.token,
            environment: device.environment,
            payload: alertPayload(current, device.lengthUnit),
            collapseId: `ship-${mmsi}`,
            expiresAt,
          });
          notified++;
        }
      } catch (err) {
        if (err.isBadToken) {
          // Warned: a dropped push-to-start token silently turns that phone's Live
          // Activities into plain notifications until the app sends a new one
          logger?.warn(
            `[alerts] dropping ${channel ? "push-to-start" : "device"} token ${(channel ? device.pushToStartToken : device.token).slice(0, 8)}… (${err.message})`
          );
          if (channel) pushDevices.clearPushToStartToken(device.pushToStartToken);
          else pushDevices.remove(device.token);
        } else {
          logger?.warn(`[alerts] push to a device failed: ${err.message}`);
        }
      }
    });
    await inBatches(androidDevices, async (device) => {
      const follow = wantsLiveActivity(device, mmsi);
      try {
        if (follow) {
          await fcm.send(fcmActivityStartMessage(device.token, current, t, device.lengthUnit));
          activity?.fcmTokens.add(device.token);
          activity?.started.add(device.token);
          liveActivities++;
        } else {
          await fcm.send(fcmAlertMessage(device.token, current, t, device.lengthUnit));
          notified++;
        }
      } catch (err) {
        if (err.isBadToken) pushDevices.remove(device.token);
        else logger?.warn(`[alerts] FCM message to a device failed: ${err.message}`);
      }
    });
    if (activity && active.get(mmsi) === activity) {
      if (activity.started.size === 0) {
        // Nobody is following it after all (every start failed): nothing to update or end
        clearTimeout(activity.timeout);
        active.delete(mmsi);
        pushDevices.removeActivity(mmsi);
        for (const channel of activity.channels) deleteChannelLater(channel);
      } else {
        save(activity);
      }
    }
    const minutes = Math.round(current.approach.etaMinutes);
    if (followersOnly) {
      logger?.log(`[alerts] ${current.name} ~${minutes} min out: ${liveActivities} Live Activities for followers`);
      return;
    }
    logger?.log(`[alerts] ${current.name} ~${minutes} min out: ${notified} notified, ${liveActivities} Live Activities`);
    emitter.emit("alert", current, { notified, liveActivities });
  }

  function send(mmsi, task) {
    sending.add(mmsi);
    task()
      .catch((err) => logger?.error(`[alerts] alert for ${mmsi} failed: ${err.message}`))
      .finally(() => sending.delete(mmsi));
  }

  function handleMessage(message) {
    if (message?.MessageType !== "PositionReport" || message.MetaData?.AisClass === "B") return;
    const mmsi = message.MetaData.MMSI;
    const current = ship(mmsi);
    const activity = active.get(mmsi);
    if (activity) updateActivity(activity, current);
    if (sending.has(mmsi)) return;
    const approach = current?.approach;
    if (!approach || current.classB) return;
    if (!(current.position?.sog >= ALERT_MIN_SPEED_KN)) return;
    if (approach.etaMinutes < ALERT_MIN_ETA_MINUTES) return;
    const t = now();
    if (approach.etaMinutes <= ALERT_MAX_ETA_MINUTES && t - (alertedAt.get(mmsi) ?? -Infinity) >= ALERT_COOLDOWN_MS) {
      alertedAt.set(mmsi, t);
      send(mmsi, () => sendAlert(current));
    } else if (
      approach.etaMinutes <= FOLLOW_MAX_ETA_MINUTES &&
      t - (followCheckedAt.get(mmsi) ?? -Infinity) >= FOLLOW_CHECK_INTERVAL_MS
    ) {
      // Ships the user follows, from further out, and phones that started
      // following it since the alert
      followCheckedAt.set(mmsi, t);
      send(mmsi, () => sendAlert(current, { followersOnly: true }));
    }
  }

  // A ship log entry changed; if it's a new passage, end that ship's Live Activity
  function handleShipLogEntry(entry) {
    const activity = active.get(entry.mmsi);
    if (!activity) return;
    const passedAt = Date.parse(entry.passages[0]?.time);
    if (passedAt < activity.startedAt) return;
    endActivity(entry.mmsi, "passed", ship(entry.mmsi), {
      ...(Number.isFinite(passedAt) && { passedAt }),
      next: nextShip(entry.mmsi),
    });
  }

  // Carry on Live Activities saved by a previous run; end and delete any other
  // channels it left open
  async function cleanUp() {
    const t = now();
    // Before anything is awaited, so no position report starts one over again
    const kept = new Set();
    for (const { mmsi, state } of pushDevices.activities()) {
      const activity = restore(mmsi, state);
      if (!activity || deadline(activity) <= t || (activity.channels.length === 0 && activity.fcmTokens.size === 0)) {
        pushDevices.removeActivity(mmsi);
        continue;
      }
      active.set(mmsi, activity);
      scheduleTimeout(activity);
      if (activity.alertedAt !== undefined) alertedAt.set(mmsi, activity.alertedAt);
      for (const channel of activity.channels) kept.add(`${channel.environment}/${channel.channelId}`);
    }
    if (active.size > 0) logger?.log(`[alerts] carrying on ${active.size} Live Activities`);
    // Only APNs keeps channels; Android phones expire their countdowns themselves
    if (!apns) return;
    for (const { channelId, environment } of pushDevices.channels()) {
      if (kept.has(`${environment}/${channelId}`)) continue;
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

  // These run inside the AIS feeds' and ship log's event handlers and on timers, where
  // a throw (the database full or locked, say) would take the whole server down
  const guarded = (what, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      logger?.error(`[alerts] ${what} failed: ${err.message}`);
      return undefined;
    }
  };

  return Object.assign(emitter, {
    handleMessage: guarded("handling a position", handleMessage),
    handleShipLogEntry: guarded("handling a passage", handleShipLogEntry),
    cleanUp,
    stop,
  });
}
