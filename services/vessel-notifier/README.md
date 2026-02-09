# Vessel Notification Service

A Node.js service that monitors AIS vessel traffic near the Blue Water Bridge and sends push notifications via [ntfy](https://ntfy.sh) when a vessel passes under the bridge.

## How It Works

1. Connects to the BridgeView AIS WebSocket proxy server
2. Receives real-time AIS position reports for vessels in the tracking area
3. Tracks each vessel's distance to the Blue Water Bridge
4. When a vessel's distance transitions below the threshold (default 0.5 NM), sends a notification via ntfy
5. Applies a cooldown per vessel (default 30 minutes) to prevent duplicate notifications

## Configuration

All configuration is done via environment variables:

| Variable                   | Required | Default               | Description                                        |
| -------------------------- | -------- | --------------------- | -------------------------------------------------- |
| `NTFY_TOPIC`               | Yes      | -                     | ntfy topic name to publish notifications to        |
| `NTFY_SERVER`              | No       | `https://ntfy.sh`     | ntfy server URL                                    |
| `NTFY_TOKEN`               | No       | -                     | ntfy access token for authentication               |
| `WS_PROXY_URL`             | No       | `ws://localhost:3001` | WebSocket proxy server URL                         |
| `WS_AUTH_TOKEN`            | No       | -                     | WebSocket proxy authentication token               |
| `BRIDGE_THRESHOLD_NM`      | No       | `0.5`                 | Distance threshold in nautical miles               |
| `NOTIFICATION_COOLDOWN_MS` | No       | `1800000` (30 min)    | Cooldown between notifications for the same vessel |

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

- **Title**: `{Vessel Name} passing under Blue Water Bridge`
- **Body**: Direction, speed, MMSI, course, destination (if available), length (if available)
- **Tags**: `ship`, `northbound`/`southbound`
- **Priority**: Default (3)

Example notification:

```
LAKE FREIGHTER passing under Blue Water Bridge

⬇️ Southbound at 8.5 knots
MMSI: 123456789
Course: 185°
Destination: DETROIT
Length: 225m
```

## Subscribing to Notifications

You can receive notifications on any device that supports ntfy:

- **Phone**: Install the [ntfy app](https://ntfy.sh) and subscribe to your topic
- **Desktop**: Use the [ntfy web app](https://ntfy.sh) or desktop notifications
- **CLI**: `curl -s ntfy.sh/your-topic/json`

## Architecture

```
AISStream.io → WebSocket Proxy (server/server.js) → Vessel Notifier → ntfy.sh → Your Devices
```

### Modules

- **`geo.ts`** - Geographic calculations (Haversine distance, direction detection)
- **`bridge-detector.ts`** - Vessel tracking and bridge crossing detection
- **`ntfy-client.ts`** - ntfy HTTP API client
- **`notifier.ts`** - Main service orchestrating WebSocket connection, detection, and notifications
- **`index.ts`** - Entry point with environment variable configuration

## Testing

49 tests covering:

- Geographic calculations (15 tests)
- Bridge crossing detection logic (18 tests)
- ntfy client message formatting and HTTP (12 tests)
- Service lifecycle (4 tests)

```bash
npm run test:coverage
```
