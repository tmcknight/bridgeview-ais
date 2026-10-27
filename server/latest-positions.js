// Each ship's latest position report from either feed, kept in memory so a client
// that connects (or reconnects) sees every ship at once instead of waiting for
// each one's next broadcast; a moored ship reports only every few minutes.

// Matches the browser's STALE_SHIP_TIMEOUT_MS: older ships would be dropped on arrival
export const POSITION_TTL_MS = 10 * 60_000;

export function createLatestPositions({ ttlMs = POSITION_TTL_MS, now = Date.now } = {}) {
  const positions = new Map(); // MMSI -> { message, receivedAt }

  // The map is ordered oldest first, so stop at the first ship still fresh
  function prune() {
    const cutoff = now() - ttlMs;
    for (const [mmsi, { receivedAt }] of positions) {
      if (receivedAt > cutoff) break;
      positions.delete(mmsi);
    }
  }

  return {
    handleMessage(message) {
      if (message.MessageType !== "PositionReport" || !message.Message?.PositionReport) return;
      const mmsi = message.MetaData.MMSI;
      // Re-insert so the map stays ordered oldest first
      positions.delete(mmsi);
      positions.set(mmsi, { message, receivedAt: now() });
      prune();
    },

    // Latest report of every ship heard within the TTL, oldest first
    messages() {
      prune();
      return Array.from(positions.values(), ({ message }) => message);
    },
  };
}
