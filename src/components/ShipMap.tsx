import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { TrackedShip } from "../types/ais";
import { NAV_STATUS_LABELS } from "../types/ais";
import {
  BRIDGE_CENTER,
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
} from "../constants/bridge";
import {
  formatDistance,
  formatSpeed,
  formatHeading,
  estimatedTimeToBridge,
  formatETA,
} from "../utils/geo";

// Bridge line coordinates (approximate endpoints of the Blue Water Bridge)
const BRIDGE_LINE: [number, number][] = [
  [43.0003, -82.4225], // Sarnia (Canadian) side
  [42.9985, -82.4065], // Port Huron (US) side
];

function createShipIcon(ship: TrackedShip): L.DivIcon {
  const rotation = ship.trueHeading !== 511 ? ship.trueHeading : ship.cog;
  const color = ship.approaching ? "#ef4444" : "#3b82f6";
  const size = 24;

  return L.divIcon({
    className: "ship-marker",
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg);">
      <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    </svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function ShipMarker({ ship }: { ship: TrackedShip }) {
  const eta = estimatedTimeToBridge(ship.distanceToBridge, ship.sog);

  return (
    <Marker
      position={[ship.latitude, ship.longitude]}
      icon={createShipIcon(ship)}
    >
      <Popup>
        <div className="ship-popup">
          <h3>{ship.name}</h3>
          <table>
            <tbody>
              <tr>
                <td>MMSI</td>
                <td>{ship.mmsi}</td>
              </tr>
              <tr>
                <td>Status</td>
                <td>{NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown"}</td>
              </tr>
              <tr>
                <td>Speed</td>
                <td>{formatSpeed(ship.sog)}</td>
              </tr>
              <tr>
                <td>Heading</td>
                <td>{formatHeading(ship.trueHeading)}</td>
              </tr>
              <tr>
                <td>Course</td>
                <td>{formatHeading(ship.cog)}</td>
              </tr>
              <tr>
                <td>Distance to Bridge</td>
                <td>{formatDistance(ship.distanceToBridge)}</td>
              </tr>
              <tr>
                <td>ETA to Bridge</td>
                <td>{formatETA(eta)}</td>
              </tr>
              {ship.destination && (
                <tr>
                  <td>Destination</td>
                  <td>{ship.destination}</td>
                </tr>
              )}
              {ship.length && ship.length > 0 && (
                <tr>
                  <td>Size</td>
                  <td>
                    {ship.length}m × {ship.width}m
                  </td>
                </tr>
              )}
              <tr>
                <td>Last Update</td>
                <td>{new Date(ship.lastUpdate).toLocaleTimeString()}</td>
              </tr>
            </tbody>
          </table>
          {ship.approaching && (
            <div className="approaching-badge">APPROACHING BRIDGE</div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

function BridgeMarker() {
  const bridgeIcon = L.divIcon({
    className: "bridge-marker",
    html: `<div class="bridge-icon">🌉</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

  return (
    <>
      <Polyline
        positions={BRIDGE_LINE}
        pathOptions={{
          color: "#f59e0b",
          weight: 4,
          dashArray: "10, 6",
          opacity: 0.8,
        }}
      />
      <Marker position={[BRIDGE_CENTER.lat, BRIDGE_CENTER.lng]} icon={bridgeIcon}>
        <Popup>
          <div className="ship-popup">
            <h3>Blue Water Bridge</h3>
            <p>Connects Sarnia, ON to Port Huron, MI</p>
            <p>Air Draft: ~46m (152 ft)</p>
          </div>
        </Popup>
      </Marker>
    </>
  );
}

function RecenterButton() {
  const map = useMap();
  return (
    <button
      className="absolute top-2.5 right-2.5 z-[1000] w-9 h-9 bg-white border-2 border-black/20 rounded text-lg text-gray-700 flex items-center justify-center cursor-pointer hover:bg-gray-100"
      onClick={() => map.setView([BRIDGE_CENTER.lat, BRIDGE_CENTER.lng], DEFAULT_ZOOM)}
      title="Re-center on bridge"
    >
      ⌖
    </button>
  );
}

interface ShipMapProps {
  ships: Map<number, TrackedShip>;
}

export default function ShipMap({ ships }: ShipMapProps) {
  return (
    <div className="w-full h-full">
      <MapContainer
        center={[BRIDGE_CENTER.lat, BRIDGE_CENTER.lng]}
        zoom={DEFAULT_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BridgeMarker />
        {Array.from(ships.values()).map((ship) => (
          <ShipMarker key={ship.mmsi} ship={ship} />
        ))}
        <RecenterButton />
      </MapContainer>
    </div>
  );
}
