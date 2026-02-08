# Stage 1: Install dependencies and build the frontend
FROM node:25-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_WS_PROXY_URL
ENV VITE_WS_PROXY_URL=${VITE_WS_PROXY_URL}

RUN npm run build

# Stage 2: Production WebSocket server
FROM node:25-alpine AS ws-server

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./

EXPOSE 3001
CMD ["node", "server.js"]

# Stage 3: Build vessel notifier
FROM node:25-alpine AS notifier-build

WORKDIR /app

COPY services/vessel-notifier/package.json services/vessel-notifier/package-lock.json ./
RUN npm ci

COPY services/vessel-notifier/ .
RUN npm run build

# Stage 4: Production vessel notifier
FROM node:25-alpine AS vessel-notifier

WORKDIR /app

ENV NODE_ENV=production

COPY services/vessel-notifier/package.json services/vessel-notifier/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=notifier-build /app/dist/ ./dist/

CMD ["node", "dist/index.js"]

# Stage 5: Nginx frontend server
FROM nginx:alpine AS frontend

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
