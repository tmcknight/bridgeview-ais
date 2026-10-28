import { EventEmitter } from "node:events";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUpstream, mergeSubscriptions, MIN_SUBSCRIPTION_INTERVAL_MS } from "./upstream.js";

const BRIDGE = [[42.9, -82.5], [43.1, -82.3]];
const WIDE = [[42.0, -83.3], [44.3, -81.6]];
const ELSEWHERE = [[41.0, -88.0], [41.5, -87.5]];

describe("mergeSubscriptions", () => {
  it("returns null with nothing to subscribe to", () => {
    expect(mergeSubscriptions([])).toBeNull();
  });

  it("keeps every area, dropping ones inside another and duplicates", () => {
    const merged = mergeSubscriptions([
      { BoundingBoxes: [WIDE] },
      { BoundingBoxes: [BRIDGE, ELSEWHERE] },
      { BoundingBoxes: [[[44.3, -81.6], [42.0, -83.3]]] },
    ]);
    expect(merged.BoundingBoxes).toEqual([WIDE, ELSEWHERE]);
  });

  it("unions message types, or drops the filter if any client has none", () => {
    expect(
      mergeSubscriptions([
        { BoundingBoxes: [WIDE], FilterMessageTypes: ["ShipStaticData", "PositionReport"] },
        { BoundingBoxes: [BRIDGE], FilterMessageTypes: ["PositionReport"] },
      ]).FilterMessageTypes
    ).toEqual(["PositionReport", "ShipStaticData"]);
    expect(
      mergeSubscriptions([
        { BoundingBoxes: [WIDE], FilterMessageTypes: ["PositionReport"] },
        { BoundingBoxes: [BRIDGE] },
      ])
    ).not.toHaveProperty("FilterMessageTypes");
  });
});

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.emit("open");
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.emit("close", 1000);
  }
}

describe("createUpstream", () => {
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let upstream;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    upstream = createUpstream({ apiKey: "KEY", logger, WebSocketImpl: FakeSocket });
  });

  afterEach(() => {
    upstream.stop();
    vi.useRealTimers();
  });

  it("opens one connection and subscribes with the API key", () => {
    upstream.setSubscription({ BoundingBoxes: [WIDE] });
    upstream.setSubscription({ BoundingBoxes: [WIDE, ELSEWHERE] });
    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.instances[0].open();
    expect(FakeSocket.instances[0].sent).toEqual([{ BoundingBoxes: [WIDE, ELSEWHERE], Apikey: "KEY" }]);
  });

  it("sends subscription changes at most about once a second", () => {
    upstream.setSubscription({ BoundingBoxes: [WIDE] });
    const socket = FakeSocket.instances[0];
    socket.open();
    upstream.setSubscription({ BoundingBoxes: [BRIDGE] });
    upstream.setSubscription({ BoundingBoxes: [ELSEWHERE] });
    expect(socket.sent).toHaveLength(1);

    vi.advanceTimersByTime(MIN_SUBSCRIPTION_INTERVAL_MS);
    expect(socket.sent.map((s) => s.BoundingBoxes)).toEqual([[WIDE], [ELSEWHERE]]);

    upstream.setSubscription({ BoundingBoxes: [ELSEWHERE] });
    vi.advanceTimersByTime(MIN_SUBSCRIPTION_INTERVAL_MS);
    expect(socket.sent).toHaveLength(2);
  });

  it("emits AIS messages and skips confirmations and errors", () => {
    const onMessage = vi.fn();
    upstream.on("message", onMessage);
    upstream.setSubscription({ BoundingBoxes: [WIDE] });
    const socket = FakeSocket.instances[0];
    socket.open();

    const ais = JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: 1 } });
    socket.emit("message", Buffer.from(JSON.stringify({ MessageType: "SubscriptionConfirmation", Message: {} })));
    socket.emit("message", Buffer.from(JSON.stringify({ error: "Api Key Is Not Valid" })));
    socket.emit("message", Buffer.from("not json"));
    socket.emit("message", Buffer.from(ais));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(JSON.parse(ais), ais);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Api Key Is Not Valid"));
  });

  it("emits Class B messages as PositionReport and ShipStaticData", () => {
    const onMessage = vi.fn();
    upstream.on("message", onMessage);
    upstream.setSubscription({ BoundingBoxes: [WIDE] });
    const socket = FakeSocket.instances[0];
    socket.open();

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          MessageType: "StandardClassBPositionReport",
          MetaData: { MMSI: 2, ShipName: "SEA BREEZE", latitude: 43, longitude: -82.4 },
          Message: { StandardClassBPositionReport: { MessageID: 18, UserID: 2, Latitude: 43, Longitude: -82.4, Sog: 5, Cog: 90, TrueHeading: 511, Timestamp: 10 } },
        })
      )
    );

    const [message, text] = onMessage.mock.calls[0];
    expect(message.MessageType).toBe("PositionReport");
    expect(message.MetaData.AisClass).toBe("B");
    expect(JSON.parse(text)).toEqual(message);
  });

  it("reconnects with backoff and resubscribes", () => {
    upstream.setSubscription({ BoundingBoxes: [WIDE] });
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].close();

    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].close();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(3);

    vi.advanceTimersByTime(MIN_SUBSCRIPTION_INTERVAL_MS);
    FakeSocket.instances[2].open();
    expect(FakeSocket.instances[2].sent).toEqual([{ BoundingBoxes: [WIDE], Apikey: "KEY" }]);
  });

  it("reports the link as connecting, up, then down with the reason", () => {
    const onLink = vi.fn();
    upstream.on("link", onLink);
    upstream.setSubscription({ BoundingBoxes: [WIDE] });
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.emit("message", Buffer.from(JSON.stringify({ error: "Api Key Is Not Valid" })));
    socket.close();

    expect(onLink.mock.calls).toEqual([
      ["connecting"],
      ["up"],
      ["down", "AISStream error: Api Key Is Not Valid"],
      ["down", "AISStream error: Api Key Is Not Valid"],
    ]);

    // Retrying stays down until the connection opens again
    vi.advanceTimersByTime(1000);
    expect(onLink).toHaveBeenCalledTimes(4);
    FakeSocket.instances[1].open();
    expect(onLink).toHaveBeenLastCalledWith("up");
  });

  it("disconnects when nothing needs data", () => {
    upstream.setSubscription({ BoundingBoxes: [WIDE] });
    FakeSocket.instances[0].open();
    upstream.setSubscription(null);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].readyState).toBe(3);
  });
});
