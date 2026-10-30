// Fake AIS proxy for demoing TV mode: one laker runs down the St. Clair River
// from southern Lake Huron, under the Blue Water Bridge, and on toward Sarnia,
// then loops. Usage: node scripts/tv-demo.mjs . [port] [options], then run Vite
// with VITE_WS_PROXY_URL=ws://localhost:<port> and open /?tv. Options, in any
// order: the kind of ship (freighter, the default, tanker, tug, sailboat or
// boat); "upbound" to run it up the river into the lake instead; "realtime" to
// run it at its reported speed throughout (for a close look at its model)
import { createRequire } from "node:module";
import path from "node:path";

const repo = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 3099);
const { WebSocketServer } = createRequire(path.join(repo, "package.json"))("ws");

// One ship of each model kind (utils/shipModel.ts): name, AIS type and size
const KINDS = {
  freighter: { name: "DEMO LAKER", type: 70, dims: { A: 180, B: 45, C: 12, D: 12 } },
  tanker: { name: "DEMO TANKER", type: 80, dims: { A: 115, B: 30, C: 11, D: 11 } },
  tug: { name: "DEMO TUG", type: 52, dims: { A: 20, B: 10, C: 5, D: 5 } },
  sailboat: { name: "DEMO SAILBOAT", type: 36, dims: { A: 9, B: 4, C: 2, D: 2 } },
  boat: { name: "DEMO BOAT", type: 60, dims: { A: 30, B: 15, C: 5, D: 5 } },
};
const OPTIONS = process.argv.slice(4);
for (const option of OPTIONS) {
  if (!(option in KINDS) && option !== "upbound" && option !== "realtime") {
    throw new Error(`Unknown option ${option}; pick from ${Object.keys(KINDS).join(", ")}, upbound, realtime`);
  }
}
const KIND = KINDS[OPTIONS.find((option) => option in KINDS) ?? "freighter"];
const UPBOUND = OPTIONS.includes("upbound");
const REALTIME = OPTIONS.includes("realtime");

const BRIDGE = [42.9982, -82.423];
// Downbound route (lat, lon), roughly mid-channel; upbound runs it backwards
const DOWNBOUND_ROUTE = [
  [43.062, -82.392],
  [43.035, -82.405],
  [43.015, -82.416],
  [43.006, -82.4205],
  [42.9982, -82.4235],
  // South of the bridge: the river's centreline from OpenStreetMap
  [42.993, -82.4243],
  [42.9849, -82.4203],
  [42.9796, -82.4162],
  [42.9761, -82.4146],
  [42.9718, -82.4159],
  [42.9678, -82.4176],
  [42.9546, -82.426],
];
const ROUTE = UPBOUND ? [...DOWNBOUND_ROUTE].reverse() : DOWNBOUND_ROUTE;
// Still on its way to the bridge
const approaching = (lat) => (UPBOUND ? lat < BRIDGE[0] : lat > BRIDGE[0]);
const STEP_NM = 0.003; // track resolution
const START_NM = 2.4; // skip the route further out than this
// Track steps per report (one a second): about 2x real speed on the way in,
// fast-forward once the cam has it (or real speed throughout with "realtime")
const stepsAt = (point) =>
  REALTIME ? 1 : !approaching(point.lat) || point.nm <= 1.05 ? 30 : point.nm > 1.3 ? 10 : 3;
const REPORTED_SOG = 11; // what the ship says its speed is (kn)
const PAUSE_S = 4; // gap between loops
const MMSI = 316999001;

const toRad = (d) => (d * Math.PI) / 180;
const distNM = ([a1, o1], [a2, o2]) => {
  const dLat = toRad(a2 - a1), dLon = toRad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const bearing = ([a1, o1], [a2, o2]) => {
  const y = Math.sin(toRad(o2 - o1)) * Math.cos(toRad(a2));
  const x = Math.cos(toRad(a1)) * Math.sin(toRad(a2)) - Math.sin(toRad(a1)) * Math.cos(toRad(a2)) * Math.cos(toRad(o2 - o1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

// Points every STEP_NM along the route, each with its course
const track = [];
for (let i = 0; i < ROUTE.length - 1; i++) {
  const [from, to] = [ROUTE[i], ROUTE[i + 1]];
  const steps = Math.max(1, Math.round(distNM(from, to) / STEP_NM));
  const cog = bearing(from, to);
  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    const lat = from[0] + (to[0] - from[0]) * t, lon = from[1] + (to[1] - from[1]) * t;
    const nm = distNM([lat, lon], BRIDGE);
    if (approaching(lat) && nm > START_NM) continue;
    track.push({ lat, lon, cog, nm });
  }
}

const meta = (lat, lon) => ({
  MMSI, MMSI_String: String(MMSI), ShipName: KIND.name, latitude: lat, longitude: lon,
  time_utc: new Date().toISOString().replace("T", " ").replace("Z", " +0000 UTC"),
});
const staticData = () => ({
  MessageType: "ShipStaticData",
  MetaData: meta(track[0].lat, track[0].lon),
  Message: { ShipStaticData: {
    Name: KIND.name, CallSign: "DEMO1", Destination: UPBOUND ? "DULUTH" : "DETROIT", ImoNumber: 0, Type: KIND.type,
    Dimension: KIND.dims, Draught: 8, MaximumStaticDraught: 8,
    AisVersion: 0, Dte: false, Eta: { Day: 0, Hour: 0, Minute: 0, Month: 0 }, MessageID: 5,
    RepeatIndicator: 0, Spare: false, UserID: MMSI, Valid: true,
  } },
});
const position = ({ lat, lon, cog }) => ({
  MessageType: "PositionReport",
  MetaData: meta(lat, lon),
  Message: { PositionReport: {
    Cog: cog, Sog: REPORTED_SOG, TrueHeading: Math.round(cog), Latitude: lat, Longitude: lon,
    NavigationalStatus: 0, MessageID: 1, UserID: MMSI, Valid: true, PositionAccuracy: true, Raim: false,
    RateOfTurn: 0, RepeatIndicator: 0, Spare: 0, SpecialManoeuvreIndicator: 0, Timestamp: 0, CommunicationState: 0,
  } },
});
const vesselInfo = {
  type: "vesselInfo", mmsi: MMSI,
  info: {
    wikidataId: "Q0", wikidataUrl: "https://www.wikidata.org", yearBuilt: 1977, operator: "Demo Steamship Co.",
    // A real laker's photo, so the demo shows one (for the laker only)
    imageUrl: KIND.type !== 70 ? undefined : "https://commons.wikimedia.org/wiki/Special:FilePath/Paul%20R.%20Tregurtha.jpg?width=640",
  },
};

const clients = new Set();
const wss = new WebSocketServer({ port });
wss.on("connection", (ws) => {
  ws.once("message", () => {
    clients.add(ws);
    ws.send(JSON.stringify(vesselInfo));
    ws.send(JSON.stringify(staticData()));
  });
  ws.on("close", () => clients.delete(ws));
});

let i = 0, pause = 0, ticks = 0;
setInterval(() => {
  if (pause > 0) return void pause--;
  const point = track[i];
  const msg = JSON.stringify(position(point));
  for (const ws of clients) ws.send(msg);
  if (++ticks % 10 === 0) console.log(`${point.nm.toFixed(2)} NM from bridge, ${approaching(point.lat) ? "approaching" : "past"}`);
  i += stepsAt(point);
  if (i >= track.length) [i, pause] = [0, PAUSE_S];
}, 1000);
console.log(`Demo AIS server on ws://localhost:${port}`);
