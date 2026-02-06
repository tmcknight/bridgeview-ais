import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.AISSTREAM_API_KEY;
const UPSTREAM = "wss://stream.aisstream.io/v0/stream";

if (!API_KEY) {
  console.error("[proxy] AISSTREAM_API_KEY environment variable is required");
  process.exit(1);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (client) => {
  console.log("[proxy] client connected, waiting for subscription...");

  let upstream = null;

  client.on("message", (data) => {
    // First message: treat as subscription, inject API key, then connect upstream
    if (!upstream) {
      let subscription;
      try {
        subscription = JSON.parse(data.toString());
      } catch {
        console.error("[proxy] first message was not valid JSON, closing");
        client.close();
        return;
      }

      subscription.Apikey = API_KEY;
      const subscriptionStr = JSON.stringify(subscription);
      console.log("[proxy] got subscription, connecting to upstream...");

      upstream = new WebSocket(UPSTREAM);

      upstream.on("open", () => {
        console.log("[proxy] upstream connected, sending subscription immediately");
        upstream.send(subscriptionStr);
      });

      upstream.on("message", (data) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data.toString());
        }
      });

      upstream.on("close", (code, reason) => {
        console.log("[proxy] upstream closed — code:", code, "reason:", reason.toString());
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });

      upstream.on("error", (err) => {
        console.error("[proxy] upstream error:", err.message);
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });

      return;
    }

    // Subsequent messages: forward to upstream
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    }
  });

  client.on("close", () => {
    console.log("[proxy] client disconnected");
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });

  client.on("error", (err) => {
    console.error("[proxy] client error:", err.message);
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
});

console.log(`[proxy] WebSocket proxy listening on ws://localhost:${PORT}`);
