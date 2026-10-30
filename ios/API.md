# BridgeView iOS API

The iOS app talks to the ws-server over plain HTTPS (nginx proxies `/api/` to it).
Everything here is open: the app is public, so it can't carry a secret. Reads are
cached and rate-limited per IP; writes are validated and rate-limited.

All times are ISO 8601 strings (UTC). Distances are nautical miles, speeds knots,
lengths metres. Optional fields are omitted, never `null`, unless noted.

## `GET /api/bridge`

Ships heading for the bridge and ships that went under it lately. The app polls it
every 30 s while open and on pull-to-refresh.

```json
{
  "generatedAt": "2026-10-30T14:02:11.000Z",
  "shipCamVideoId": "AwP_Q6IGwFs",
  "attribution": [
    { "text": "Data: AISHub contributors", "url": "https://www.aishub.net" },
    { "text": "AISStream.io", "url": "https://aisstream.io" }
  ],
  "upcoming": [ /* Ship with "approach", soonest first, ETA within 3 h */ ],
  "recent":   [ /* Ship with "passage", newest first, within the last 24 h */ ]
}
```

- `attribution`: credits for the AIS feeds the server uses, one per feed, in this
  order: AISHub (`aishub` in `AIS_SOURCES`), then AISStream.io (`aisstream`). Empty
  when only the local antenna is used. The app must show each as a link (`text`
  opening `url`) clearly visible near the ship lists; AISHub's terms require its
  credit near the data.

### Ship

```json
{
  "mmsi": 316001234,
  "name": "ALGOMA EQUINOX",
  "imo": 9613927,
  "callSign": "CFK9876",
  "shipType": 70,
  "shipTypeName": "Cargo",
  "category": "cargo",
  "length": 225,
  "width": 24,
  "draught": 8.1,
  "destination": "THUNDER BAY",
  "cargo": "Likely going to load grain",
  "flag": "CA",
  "position": {
    "latitude": 42.95, "longitude": -82.42,
    "sog": 11.2, "cog": 2.5, "heading": 3, "navStatus": 0,
    "time": "2026-10-30T14:01:50.000Z"
  },
  "approach": {
    "etaMinutes": 8.4,
    "eta": "2026-10-30T14:10:35.000Z",
    "distanceNM": 1.6,
    "direction": "upbound"
  },
  "passage": {
    "time": "2026-10-30T12:44:00.000Z",
    "direction": "downbound"
  },
  "info": {
    "wikidataId": "Q123",
    "wikidataUrl": "https://www.wikidata.org/wiki/Q123",
    "name": "Algoma Equinox",
    "description": "bulk carrier built 2013",
    "imageUrl": "https://commons.wikimedia.org/...",
    "imagePageUrl": "https://commons.wikimedia.org/wiki/File:...",
    "yearBuilt": 2013,
    "builder": "Nantong Mingde",
    "operator": "Algoma Central",
    "grossTonnage": 24300,
    "wikipediaUrl": "https://en.wikipedia.org/wiki/..."
  }
}
```

- `category`: one of `cargo`, `tanker`, `passenger`, `other` (from AIS ship type 70–79,
  80–89, 60–69, anything else). Alert preferences filter on it.
- `direction`: `upbound` (northbound, into Lake Huron) or `downbound` (southbound).
- `flag`: ISO 3166 alpha-2 from the MMSI's country code, when known.
- `position` is missing for a ship not heard in the last 10 minutes, and when the
  ship's latest position came from AISHub: its terms don't allow passing on positions
  (live or historical) through an open API. `approach` is still sent for such a ship,
  since it's worked out by the server; so a ship can have an `approach` and no
  `position`. Nothing else in the API carries positions or tracks: `passage` and
  `passages` are only times and directions.
- `info` (Wikidata) is missing when the ship hasn't been looked up or has no match.

## `GET /api/ships/:mmsi`

One ship, as above, with `passages` (newest first, up to 50) in place of `passage`,
and `approach` when it's heading for the bridge. 404 for an unknown ship.

## `PUT /api/devices/:token`

Register or update this device for bridge alerts. `:token` is the APNs device
token (hex). Idempotent; call on every launch and whenever a setting changes.

```json
{
  "environment": "production",
  "enabled": true,
  "pushToStartToken": "80f7…",
  "liveActivities": true,
  "categories": ["cargo", "tanker", "passenger"],
  "minLength": 100,
  "directions": ["upbound", "downbound"]
}
```

- `environment`: `sandbox` (Debug builds) or `production` (TestFlight/App Store).
- `enabled`: false when alerts are off, and also while the phone is away from the
  bridge if the user chose "Only when I'm near the bridge". The app works that out
  itself with a geofence and sends `enabled` again on each crossing; its location
  is never sent.
- `pushToStartToken`: ActivityKit push-to-start token for `ShipApproachAttributes`
  (hex), when the app has one.
- `liveActivities`: `ActivityAuthorizationInfo().areActivitiesEnabled`. With it and a
  push-to-start token, the alert starts a Live Activity (which shows its own alert);
  otherwise the device gets a normal notification.
- `minLength`: 0 for any; ships of unknown length count as 0.

204 on success, 400 with `{ "error": "…" }` on bad input.

## `DELETE /api/devices/:token`

Stop all alerts to this device. 204.

## Push payloads

### Bridge alert (normal notification)

Sent once per ship when its ETA first falls to 10 minutes or less (and is still
3 or more), to every enabled device whose preferences match.

```json
{
  "aps": {
    "alert": {
      "title": "ALGOMA EQUINOX in ~8 min",
      "subtitle": "Upbound · Cargo · 225 m",
      "body": "Heading for Thunder Bay. Likely going to load grain."
    },
    "sound": "default",
    "thread-id": "bridge",
    "interruption-level": "time-sensitive",
    "relevance-score": 1
  },
  "mmsi": 316001234
}
```

`apns-collapse-id` is `ship-<mmsi>`. Tapping it opens the ship.

### Live Activity: `ShipApproachAttributes`

Started by push-to-start on a per-passage broadcast channel (`input-push-channel`),
then updated and ended with broadcast pushes on that channel. iOS 18+.

`attributes` (fixed for the activity):

```json
{
  "mmsi": 316001234,
  "name": "ALGOMA EQUINOX",
  "direction": "upbound",
  "shipTypeName": "Cargo",
  "length": 225,
  "destination": "THUNDER BAY"
}
```

`content-state` (changes):

```json
{
  "eta": 815090000.0,
  "distanceNM": 1.6,
  "sog": 11.2,
  "phase": "approaching"
}
```

- `eta` is seconds since 2001-01-01 (Swift `Date`'s default `Codable` form, which the
  system decodes Live Activity payloads with).
- `phase`: `approaching` while it heads for the bridge, `passed` once it's gone
  under (sent with `event: end`), `lost` if the ship stops or turns away.

Updates go out at most once a minute, only when the ETA moves by a minute or more.
The activity ends when the ship passes (dismissed 15 minutes later) or after
30 minutes with no passage.
