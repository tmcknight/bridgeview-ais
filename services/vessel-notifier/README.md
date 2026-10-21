# Vessel Notification Service

A Node.js service that monitors AIS vessel traffic around one or more watch points (the Blue Water Bridge by default) and, when a vessel passes one, sends a push notification via [ntfy](https://ntfy.sh) and/or POSTs a JSON webhook with the vessel's details.

## How It Works

1. Connects to the BridgeView AIS WebSocket proxy server
2. Receives real-time AIS position reports for vessels in the tracking area
3. Tracks each vessel's distance to every watch point
4. When a moving vessel is about to pass a point (its course takes it within the point's radius, default 0.5 NM), predicts from its speed and course when it will be abeam and sends an ntfy notification and/or webhook at that moment. Each new report re-predicts or cancels, and predictions look up to 10 minutes ahead (`PREDICTION_HORIZON_SECONDS`). AIS reports in the area can be a minute or more apart, so this keeps alerts live. If a passage could not be predicted (no course broadcast, or the vessel sped up), it is caught on the first report after the vessel is abeam instead
5. Looks each vessel up on [Wikidata](https://www.wikidata.org) (by MMSI / IMO) as soon as it is seen, so details like build year, builder, operator, tonnage, photo and Wikipedia link are ready by the time it passes. An alert waits at most 1.5 s for a lookup still in flight, then goes out without the details
6. Applies a cooldown per vessel and point (default 30 minutes) to prevent duplicate notifications

## Configuration

All configuration is done via environment variables:

| Variable                   | Required | Default               | Description                                        |
| -------------------------- | -------- | --------------------- | -------------------------------------------------- |
| `NTFY_TOPIC`               | One of\* | -                     | ntfy topic name to publish notifications to        |
| `WEBHOOK_URL`              | One of\* | -                     | URL that receives a JSON POST for each passage     |
| `WEBHOOK_SECRET`           | No       | -                     | Secret for signing webhook bodies (HMAC-SHA256)    |
| `WATCH_POINTS`             | No       | Blue Water Bridge     | JSON array of points to watch (max 5), see below   |
| `VESSEL_INFO_LOOKUP`       | No       | `true`                | Set to `false` to skip Wikidata vessel lookups     |
| `PREDICTION_HORIZON_SECONDS` | No     | `600` (10 min)        | How far ahead to predict passages; `0` disables    |
| `NTFY_SERVER`              | No       | `https://ntfy.sh`     | ntfy server URL                                    |
| `NTFY_TOKEN`               | No       | -                     | ntfy access token for authentication               |
| `WS_PROXY_URL`             | No       | `ws://localhost:3001` | WebSocket proxy server URL                         |
| `WS_AUTH_TOKEN`            | No       | -                     | WebSocket proxy authentication token               |
| `BRIDGE_THRESHOLD_NM`      | No       | `0.5`                 | Default radius (max passing distance) in NM        |
| `NOTIFICATION_COOLDOWN_MS` | No       | `1800000` (30 min)    | Cooldown between notifications for the same vessel |

\* At least one of `NTFY_TOPIC` or `WEBHOOK_URL` must be set.

### Watch points

`WATCH_POINTS` is a JSON array. Each point needs `name`, `lat` and `lon`; `radiusNM` (how close the vessel's track must pass, and how near it must still be when the alert fires) defaults to `BRIDGE_THRESHOLD_NM`, and `id` defaults to a slug of the name. The AIS subscription covers each point plus 5 NM, and the proxy allows at most 5 points.

```bash
WATCH_POINTS='[
  {"name": "Blue Water Bridge", "lat": 42.9982, "lon": -82.423, "radiusNM": 0.5},
  {"id": "sarnia-dock", "name": "Sarnia Government Dock", "lat": 42.9705, "lon": -82.4096, "radiusNM": 0.3}
]'
```

The proxy (`server/server.js`) forwards these boxes to AISStream.io, so points can be anywhere, not only near the bridge.

## Webhooks

When `WEBHOOK_URL` is set, each passage is POSTed as JSON:

```json
{
  "event": "vessel.passage",
  "timestamp": "2026-10-21T12:00:00.000Z",
  "watchPoint": {
    "id": "blue-water-bridge",
    "name": "Blue Water Bridge",
    "latitude": 42.9982,
    "longitude": -82.423,
    "radiusNM": 0.5
  },
  "distanceNM": 0.031,
  "closestApproachNM": 0.012,
  "timing": "predicted",
  "direction": "southbound",
  "vessel": {
    "mmsi": 316001234,
    "name": "LAKE FREIGHTER",
    "imo": 1234567,
    "callSign": "CFA1234",
    "shipType": 70,
    "destination": "DETROIT",
    "lengthM": 225,
    "beamM": 24,
    "latitude": 43.0021,
    "longitude": -82.4232,
    "speedKnots": 8.5,
    "courseDeg": 182,
    "headingDeg": 181,
    "navStatus": 0,
    "navStatusLabel": "Under way using engine",
    "wikidata": {
      "wikidataId": "Q6719625",
      "wikidataUrl": "https://www.wikidata.org/wiki/Q6719625",
      "name": "Indiana Harbor",
      "description": "self-discharging bulk carrier",
      "imageUrl": "https://commons.wikimedia.org/wiki/Special:FilePath/Lakers%20Indiana%20Harbor.jpg?width=480",
      "imagePageUrl": "https://commons.wikimedia.org/wiki/File:Lakers%20Indiana%20Harbor.jpg",
      "yearBuilt": 1979,
      "builder": "Bay Shipbuilding Company",
      "grossTonnage": 35923,
      "wikipediaUrl": "https://en.wikipedia.org/wiki/MV_Indiana_Harbor"
    }
  }
}
```

`timing` is `"predicted"` when the alert fired at the estimated moment of passing (position is then the estimated abeam position) or `"observed"` when it fired on the first report after passing. `closestApproachNM` is how close the track came (or is predicted to come) to the point; `distanceNM` is the distance at the alert position. Fields under `vessel` other than `mmsi`, `name`, position, speed and course are only present once the vessel has broadcast them (static data arrives less often than positions). `vessel.wikidata` is present only when the vessel is on Wikidata and the lookup finished in time; its fields are each optional except the id and URL.

If `WEBHOOK_SECRET` is set, requests carry `X-BridgeView-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body. Verify it before trusting the payload:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
const valid =
  signature.length === expected.length &&
  timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
```

Delivery is a single attempt with a 10 s timeout; failures are logged and not retried.

## Local Development

```bash
# Install dependencies
npm install

# Run in development mode
NTFY_TOPIC=my-topic npm run dev

# Run tests
npm test

# Run tests once with coverage
npm run test:coverage

# Build for production
npm run build

# Run production build
NTFY_TOPIC=my-topic npm start
```

## Docker

The service is included in the project's Docker Compose setup. See the [project infra/DOCKER.md](../../infra/DOCKER.md) for details.

```bash
# Run with Docker Compose (from project root)
NTFY_TOPIC=my-topic docker compose up vessel-notifier -d
```

## Notification Format

Notifications include:

- **Title**: `{Vessel Name} passing {Watch Point Name}`
- **Body**: Direction, speed, MMSI, course, destination (if available), length (if available), plus type, build year/builder, operator and gross tonnage from Wikidata (if found)
- **Attachment**: Vessel photo from Wikimedia Commons (if found)
- **Click**: Opens the vessel's Wikipedia article, or its Wikidata page
- **Tags**: `ship`, `northbound`/`southbound`
- **Priority**: Default (3)

Example notification:

```
LAKE FREIGHTER passing Blue Water Bridge

⬇️ Southbound at 8.5 knots
MMSI: 123456789
Course: 185°
Destination: DETROIT
Length: 225m
Type: self-discharging bulk carrier
Built 1979 by Bay Shipbuilding Company
Gross tonnage: 35,923
```

## Subscribing to Notifications

You can receive notifications on any device that supports ntfy:

- **Phone**: Install the [ntfy app](https://ntfy.sh) and subscribe to your topic
- **Desktop**: Use the [ntfy web app](https://ntfy.sh) or desktop notifications
- **CLI**: `curl -s ntfy.sh/your-topic/json`

## Architecture

```
AISStream.io → WebSocket Proxy (server/server.js) → Vessel Notifier ─┬→ ntfy.sh → Your Devices
                                                                     └→ Your webhook endpoint
```

### Modules

- **`geo.ts`** - Geographic calculations (Haversine distance, direction detection)
- **`watch-point-detector.ts`** - Vessel tracking and watch point passage detection
- **`watch-points.ts`** - `WATCH_POINTS` parsing and validation
- **`ntfy-client.ts`** - ntfy HTTP API client
- **`webhook-client.ts`** - Signed JSON webhook client
- **`wikidata.ts`** - Cached Wikidata vessel lookup (mirrors `src/utils/wikidata.ts` in the web app)
- **`notifier.ts`** - Main service orchestrating WebSocket connection, detection, and notifications
- **`index.ts`** - Entry point with environment variable configuration

## Testing

Tests cover:

- Geographic calculations
- Watch point passage prediction/detection and `WATCH_POINTS` parsing
- ntfy and webhook formatting, signing and HTTP
- Wikidata query/parsing, caching, timeouts and failure retry
- Service lifecycle and subscription

```bash
npm run test:coverage
```
