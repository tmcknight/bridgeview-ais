# Docker Setup

BridgeView AIS can be run in Docker using `docker compose` from the repo root. The setup uses three containers:

- **bridgeview-ais-frontend**: Nginx serving the built React app and proxying WebSocket connections
- **ws-server**: Node.js WebSocket proxy server connecting to AISStream.io
- **vessel-notifier**: Node.js service that sends push notifications via [ntfy](https://ntfy.sh) when vessels pass under the bridge

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- An [AISStream.io](https://aisstream.io/) API key

## Quick Start

1. Create a `.env` file with your API key:

```bash
cp .example.env .env
# Edit .env and set AISSTREAM_API_KEY
```

2. Build and start the containers:

```bash
docker compose up --build -d
```

3. Open http://localhost:3000 in your browser.

## Configuration

Environment variables are configured in `.env` and passed to the containers via `docker-compose.yml`.

| Variable            | Required | Default           | Description                          |
| ------------------- | -------- | ----------------- | ------------------------------------ |
| `AISSTREAM_API_KEY` | Yes      | —                 | Your AISStream.io API key            |
| `WS_AUTH_TOKEN`     | No       | —                 | Token for WebSocket authentication   |
| `APP_PORT`          | No       | `3000`            | Host port for the web interface      |
| `APP_BIND`          | No       | `0.0.0.0`         | Host address the web port binds to; `127.0.0.1` keeps it off the network when a reverse proxy on the same host fronts it |
| `NTFY_TOPIC`        | No       | `bridgeview-ais`  | ntfy topic for vessel notifications  |
| `NTFY_SERVER`       | No       | `https://ntfy.sh` | ntfy server URL                      |
| `NTFY_TOKEN`        | No       | —                 | ntfy access token for authentication |
| `WEBHOOK_URL`       | No       | —                 | URL that receives passage webhooks   |
| `WEBHOOK_SECRET`    | No       | —                 | HMAC secret for signing webhooks     |
| `WATCH_POINTS`      | No       | Blue Water Bridge | JSON array of points to watch        |
| `VESSEL_INFO_LOOKUP`| No       | `true`            | Look up Wikidata vessel details (photo, build year) for alerts and the app|
| `VESSEL_REGISTRY`   | No       | `true`            | Import Transport Canada's vessel register weekly (build year, tonnage, port of registry) |
| `USCG_LOOKUP`       | No       | `true`            | Look ships up in USCG PSIX records (service type, flag, tonnage, deadweight) |
| `AIRCRAFT_TRACKING` | No       | `true`            | Show aircraft from an ADS-B feed on the map |
| `ADSB_URL`          | No       | adsb.fi, 40 NM around the bridge | ADS-B feed to poll; a local readsb/tar1090 `aircraft.json` works too |
| `YOUTUBE_API_KEY`   | No       | —                 | YouTube Data API key; finds the ship cam's live video when its stream restarts |
| `APNS_KEY_ID`       | For iOS alerts | —           | APNs auth key ID; with the three below, turns on the iOS app's bridge alerts |
| `APNS_TEAM_ID`      | For iOS alerts | —           | Apple developer team ID |
| `APNS_BUNDLE_ID`    | For iOS alerts | —           | The iOS app's bundle ID |
| `APNS_KEY`          | For iOS alerts | —           | The APNs `.p8` key's contents (newlines may be written as `\n`) |
| `ADMIN_PASSWORD`    | No       | —                 | Password for the ship data admin page; off when unset. Uploaded photos are kept on the `ship-log` volume unless R2 is set up; photo sharing from the iOS app needs both this and R2 |
| `R2_ACCOUNT_ID`     | For R2 photos | —            | Cloudflare account ID; with the four below, admin uploads go to an R2 bucket |
| `R2_ACCESS_KEY_ID`  | For R2 photos | —            | R2 API token's access key ID (Object Read & Write on the bucket) |
| `R2_SECRET_ACCESS_KEY` | For R2 photos | —         | R2 API token's secret access key |
| `R2_BUCKET`         | For R2 photos | —            | Bucket name |
| `PHOTOS_PUBLIC_URL` | For R2 photos | —            | The bucket's public custom domain, e.g. `https://photos.example.com` |
| `LOCAL_AIS_WEB_URL` | No       | —                 | AIS-catcher's web view, linked from the status menu |
| `AIS_SOURCES`       | No       | `aisstream,local` | AIS feeds to use, comma-separated: `aisstream`, `local`, `aishub` |
| `AISHUB_API_KEY`    | With `aishub` | —            | AISHub API key (AISHub calls it a username) |

## Architecture

```
Browser  -->  Nginx (:80)  --/ws-->  ws-server (:3001)  -->  AISStream.io
                |                          |
           static files          vessel-notifier  -->  ntfy.sh
           (React app)
```

Nginx serves the production-built frontend and proxies WebSocket connections on `/ws`, and the iOS app's API on `/api/` ([ios/API.md](../ios/API.md)), to the Node.js backend. The frontend connects to `/ws` on whatever host served it (`wss://` under HTTPS), so it goes through the nginx proxy on any hostname without a rebuild.

The ws-server keeps a shared log of ships that have gone under the bridge. It saves the log to `/app/data/ship-log.json` on the `ship-log` named volume, so the log survives rebuilds and restarts. It also keeps each ship's latest details (name, destination, size, type) and its Wikidata details (photo link, build year, operator) in a SQLite database at `/app/data/bridgeview.db` on the same volume. Devices registered for iOS bridge alerts are kept in the same database. `docker compose down -v` deletes the volume, and the log and database with it.

## Commands

```bash
# Build and start
docker compose up --build -d

# View logs
docker compose logs -f

# View logs for a specific service
docker compose logs -f ws-server
docker compose logs -f bridgeview-ais-frontend
docker compose logs -f vessel-notifier

# Stop
docker compose down

# Rebuild after code changes
docker compose up --build -d
```

## Building Individual Targets

The Dockerfile uses multi-stage builds. You can build individual stages:

```bash
# Build only the WebSocket server image
docker build -f infra/Dockerfile --target ws-server -t bridgeview-ws .

# Build only the frontend image
docker build -f infra/Dockerfile --target frontend -t bridgeview-frontend .

# Build only the vessel notifier image
docker build -f infra/Dockerfile --target vessel-notifier -t bridgeview-notifier .
```

## Custom WebSocket URL

The built frontend connects to `/ws` on its own host. To point it at a WebSocket proxy somewhere else, set `VITE_WS_PROXY_URL` at build time:

```bash
docker compose build --build-arg VITE_WS_PROXY_URL=wss://your-domain.com/ws
docker compose up -d
```

For secure WebSocket connections (wss://), configure TLS termination in your reverse proxy or load balancer.

## Production Considerations


- Set `WS_AUTH_TOKEN` to require authentication for WebSocket connections
- Use a reverse proxy with TLS termination for HTTPS/WSS
- The nginx container caches static assets with long-lived headers
- Both containers are configured with `restart: unless-stopped`
- Behind Cloudflare Access, these must be public (a Bypass policy) along with `/api/`: the plain pages the iOS app and App Store listing link to, `/about.html`, `/support.html`, `/privacy.html` and `/terms.html`, and what they load, `/pages.css`, `/favicon.png` and `/icon-192.png`. A new page in `public/` needs adding there too
