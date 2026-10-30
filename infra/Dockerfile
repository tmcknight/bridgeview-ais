# Stage 1: Install dependencies and build the frontend
FROM node:26-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_WS_PROXY_URL
ENV VITE_WS_PROXY_URL=${VITE_WS_PROXY_URL}

RUN npm run build

# Stage 2: Production WebSocket server
FROM node:26-alpine AS ws-server

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/server.js server/local-receiver.js server/ship-log.js server/upstream.js server/feed-status.js server/vessel-details.js server/wikidata.js server/latest-positions.js server/class-b.js server/aircraft.js server/aishub.js server/ship-cams.js ./

# Shared ship log and ship details database; mount a volume here to keep them across container restarts
ENV SHIP_LOG_FILE=/app/data/ship-log.json
ENV DB_FILE=/app/data/bridgeview.db
VOLUME /app/data

EXPOSE 3001
CMD ["node", "server.js"]

# Stage 3: Build vessel notifier
FROM node:26-alpine AS notifier-build

WORKDIR /app

COPY services/vessel-notifier/package.json services/vessel-notifier/package-lock.json ./
RUN npm ci

COPY services/vessel-notifier/ .
RUN npm run build

# Stage 4: Production vessel notifier
FROM node:26-alpine AS vessel-notifier

WORKDIR /app

ENV NODE_ENV=production

COPY services/vessel-notifier/package.json services/vessel-notifier/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=notifier-build /app/dist/ ./dist/

CMD ["node", "dist/index.js"]

# Stage 5: Nginx frontend server
FROM nginx:alpine AS frontend

COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
