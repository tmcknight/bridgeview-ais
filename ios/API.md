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
  "photoSharing": true,
  "upcoming": [ /* Ship with "approach", soonest first, ETA within 3 h; ships just
                   through the bridge stay first, passing, for about 0.5 NM */ ],
  "recent":   [ /* Ship with "passage", newest first, within the last 24 h */ ]
}
```

- `attribution`: credits for the AIS feeds the server uses, one per feed, in this
  order: AISHub (`aishub` in `AIS_SOURCES`), then AISStream.io (`aisstream`). Empty
  when only the local antenna is used. The app must show each as a link (`text`
  opening `url`) clearly visible near the ship lists; AISHub's terms require its
  credit near the data.
- `photoSharing`: whether the server takes photos shared from the app (it needs the
  admin page and R2 photo storage set up)
  (`POST /api/ships/:mmsi/photos`). Hide the button when it's false or missing.
- `photoReporting`: whether the server takes photo reports
  (`POST /api/ships/:mmsi/photos/report`). When it's false or missing, "Report this
  photo" opens the support page, which says how to report one by email.

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
    /* "passing": true, with etaMinutes and distanceNM 0 and eta the report's time,
       while it's just through the bridge (within 0.5 NM, carrying on) */
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
    "wikipediaUrl": "https://en.wikipedia.org/wiki/...",
    "photos": [
      {
        "url": "https://upload.wikimedia.org/.../500px-Algoma_Equinox.jpg",
        "pageUrl": "https://commons.wikimedia.org/wiki/File:Algoma_Equinox.jpg",
        "title": "Algoma Equinox",
        "artist": "booledozer",
        "license": "Public domain",
        "year": 2014
      }
    ],
    "registry": {
      "source": "transport-canada",
      "officialNumber": "837491",
      "name": "ALGOMA EQUINOX",
      "hullNumber": "MD-149-GB-01",
      "vesselType": "CARGO",
      "yearBuilt": 2012,
      "portOfRegistry": "ST. CATHARINES",
      "grossTonnage": 24451,
      "netTonnage": 10382,
      "length": 222.48,
      "breadth": 23.77,
      "depth": 14.69,
      "speed": 14,
      "enginePowerKw": 6929
    },
    "uscg": {
      "source": "uscg",
      "vesselId": 1225032,
      "name": "ALGOMA EQUINOX",
      "flag": "Canada",
      "serviceType": "Freight Ship",
      "serviceSubType": "General",
      "status": "Active",
      "grossTonnage": 23895
    }
  }
}
```

- `category`: one of `cargo`, `tanker`, `passenger`, `other` (from AIS ship type 70–79,
  80–89, 60–69, anything else). Alert preferences filter on it.
- `direction`: `upbound` (northbound, into Lake Huron) or `downbound` (southbound).
- `cargo`: a guess from `destination` at a port with a well-known bulk trade, only
  for cargo ships and tankers (`shipType` 70–89) of 100 m or more.
- `flag`: ISO 3166 alpha-2 from the MMSI's country code, when known.
- `position` is missing for a ship not heard in the last 10 minutes, and when the
  ship's latest position came from AISHub: its terms don't allow passing on positions
  (live or historical) through an open API. `approach` is still sent for such a ship,
  since it's worked out by the server; so a ship can have an `approach` and no
  `position`. Only `GET /api/map` carries other positions, under the same rule, and
  nothing carries tracks: `passage` and `passages` are only times and directions.
- `info` is missing when the ship hasn't been looked up or no source has it. Its
  Wikidata fields (`wikidataId`, photo, builder, operator, …) come from Wikidata;
  `registry` is the ship's Transport Canada register record and `uscg` its USCG PSIX
  record, each only when that register has the ship. `yearBuilt` and `grossTonnage`
  are Wikidata's, else Transport Canada's, else the USCG's.
- `info.photos`: up to 12 Wikimedia Commons photos, best first (Wikidata's own photo
  leads). Show `artist` and `license` with each photo: most Commons licences require
  credit. `imageUrl` is the first photo when Wikidata has none of its own.
- `info.uscg` leaves out the ship's USCG inspection history, which the server keeps
  for the web map only.
- API versions: send `?v=2` (on `/api/bridge` and `/api/ships/:mmsi`) to get `info`
  for ships only the registers know, without `wikidataId`. Without it, `info` is
  sent only when it has `wikidataId`, since app builds before v2 can't decode it
  otherwise.

## `GET /api/ships/:mmsi`

One ship, as above, with `passages` (newest first, up to 50) in place of `passage`,
and `approach` when it's heading for the bridge. 404 for an unknown ship.

## `GET /api/map`

Every ship heard in the last 10 minutes, for the app's map. The app polls it every
5 s while the map is on screen and moves ships along their course in between.

```json
{
  "generatedAt": "2026-10-30T14:02:11.000Z",
  "attribution": [ /* as in GET /api/bridge */ ],
  "ships": [ /* Ship with only mmsi, name, shipTypeName, category, length, width,
                flag, classB, position and approach (when heading for the bridge) */ ]
}
```

- Every ship has a `position`. Ships whose latest position came from AISHub are left
  out (see `position` above).
- `classB`: `true` for Class B transponders (pleasure craft, small workboats);
  omitted otherwise. They never have an `approach`.

## `POST /api/ships/:mmsi/photos`

Share a photo of a ship. It waits for approval on the admin page before anyone
sees it; once approved it's the ship's first photo in `info.photos`, with `artist`
the name given and `license` "Used with permission" (neither when no name was
given). The sharer keeps the copyright and licenses it to BridgeView (terms.html).

- Body: the photo as a JPEG (`Content-Type: image/jpeg`), at most 10 MB. The app
  redraws it at most 2048 px across (SDR), which also drops its metadata. The
  server checks it's a whole JPEG (one frame, a scan, an end-of-image marker),
  strips EXIF, IPTC and comments, and cuts off anything after the picture (an HDR
  gain map, or data hidden there).
- Size: 640 px or more on the longest side, at most 8192 px a side and 40 MP, and
  no longer than 4:1.
- The same file (by SHA-256 once cleaned) can't be sent twice: 409 while it's
  waiting or once it's approved, 422 once it's been rejected.
- Query: `artist` (optional, up to 80 characters): the name to credit; `note`
  (optional, up to 500): for the admin only.
- Header `X-BridgeView-Device`: a random UUID the app keeps in its keychain, so a
  sender can be banned. Optional, but without it only the IP address can be.

202 `{ "status": "pending" }` when queued. Errors carry `{ "error": "…" }` meant for
the user: 400 bad input, 403 banned, 404 unknown ship, 409 already shared, 413 too big,
415 not a (whole) JPEG, 422 the wrong size or rejected before, 429 more than 10 an
hour from one IP address, 503 sharing off or too many waiting.

## `POST /api/ships/:mmsi/photos/report`

Report one of the ship's photos (from `info.photos`) for the admin page to check.

```json
{ "url": "https://photos.example/shared/….jpg", "reason": "wrong-ship", "details": "…" }
```

- `reason`: `wrong-ship`, `offensive`, `privacy`, `copyright` or `other`.
- `details`: optional, up to 500 characters.
- Header `X-BridgeView-Device` as for sharing; one report per photo counts per device
  (or IP address without it).

202 `{ "status": "received" }`. Errors carry `{ "error": "…" }` meant for the user: 400
bad input, 404 not one of the ship's photos, 429 more than 20 an hour from one IP
address, 503 reporting off.

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
  "directions": ["upbound", "downbound"],
  "liveActivityShips": { "316001234": true, "366999000": false }
}
```

- `environment`: `sandbox` (Debug builds) or `production` (TestFlight/App Store).
- `enabled`: false when alerts are off, and also while the phone is away from the
  bridge if the user chose "Only when I'm near the bridge". The app works that out
  itself with a geofence and sends `enabled` again on each crossing; its location
  is never sent.
- `pushToStartToken`: ActivityKit push-to-start token for `ShipApproachAttributes`
  (hex), when the app has one. Left out, the token already stored is kept (a
  token APNs rejects is dropped), so a registration sent before iOS hands the
  token over again doesn't stop Live Activities.
- `liveActivities`: `ActivityAuthorizationInfo().areActivitiesEnabled`. With it and a
  push-to-start token, the alert starts a Live Activity (which shows its own alert);
  otherwise the device gets a normal notification. The user's default when iOS allows
  them; false when it doesn't.
- `liveActivityShips`: up to 50 ships (MMSI as a string) the user turned Live
  Activities on or off for, overriding `liveActivities` for that ship. `true` also
  alerts for that ship when `categories`, `minLength` or `directions` would skip it
  (still not while `enabled` is false). Optional; the app sends only ships coming up.
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
