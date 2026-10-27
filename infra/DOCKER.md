# Docker Setup

BridgeView AIS can be run in Docker using `docker compose` from the repo root. The setup uses three containers:

- **frontend**: Nginx serving the built React app and proxying WebSocket connections
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

## Architecture

```
Browser  -->  Nginx (:80)  --/ws-->  ws-server (:3001)  -->  AISStream.io
                |                          |
           static files          vessel-notifier  -->  ntfy.sh
           (React app)
```

Nginx serves the production-built frontend and proxies WebSocket connections on `/ws` to the Node.js backend. The frontend connects to `/ws` on whatever host served it (`wss://` under HTTPS), so it goes through the nginx proxy on any hostname without a rebuild.

The ws-server keeps a shared log of ships that have gone under the bridge. It saves the log to `/app/data/ship-log.json` on the `ship-log` named volume, so the log survives rebuilds and restarts. It also keeps each ship's latest details (name, destination, size, type) and its Wikidata details (photo link, build year, operator) in a SQLite database at `/app/data/bridgeview.db` on the same volume. `docker compose down -v` deletes the volume, and the log and database with it.

## Commands

```bash
# Build and start
docker compose up --build -d

# View logs
docker compose logs -f

# View logs for a specific service
docker compose logs -f ws-server
docker compose logs -f frontend
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
