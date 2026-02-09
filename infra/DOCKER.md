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
| `NTFY_TOPIC`        | No       | `bridgeview-ais`  | ntfy topic for vessel notifications  |
| `NTFY_SERVER`       | No       | `https://ntfy.sh` | ntfy server URL                      |
| `NTFY_TOKEN`        | No       | —                 | ntfy access token for authentication |

## Architecture

```
Browser  -->  Nginx (:80)  --/ws-->  ws-server (:3001)  -->  AISStream.io
                |                          |
           static files          vessel-notifier  -->  ntfy.sh
           (React app)
```

Nginx serves the production-built frontend and proxies WebSocket connections on `/ws` to the Node.js backend. The frontend is built with `VITE_WS_PROXY_URL=ws://localhost/ws` so it connects through the nginx proxy.

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
docker build -f infra/Dockerfile --target frontend -t bridgeview-frontend \
  --build-arg VITE_WS_PROXY_URL=ws://your-domain.com/ws .

# Build only the vessel notifier image
docker build -f infra/Dockerfile --target vessel-notifier -t bridgeview-notifier .
```

## Custom WebSocket URL

If deploying behind a reverse proxy or on a custom domain, set `VITE_WS_PROXY_URL` at build time:

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
