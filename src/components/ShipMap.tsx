import { MapContainer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";
import { useEffect } from "react";
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
import {
  BoltIcon,
  MapPinIcon,
  ClockIcon,
  ArrowUpIcon,
  FlagIcon,
  ArrowsPointingOutIcon,
  GlobeAmericasIcon,
  ArrowsUpDownIcon,
} from "@heroicons/react/20/solid";

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
  const headingDeg = ship.trueHeading !== 511 ? ship.trueHeading : ship.cog;

  return (
    <Marker
      position={[ship.latitude, ship.longitude]}
      icon={createShipIcon(ship)}
    >
      <Popup>
        <div className="ship-popup">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="!m-0 text-base font-bold text-slate-800 leading-tight">{ship.name}</h3>
            {ship.approaching && (
              <span className="shrink-0 text-[0.6rem] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded tracking-wide">
                APPROACHING
              </span>
            )}
          </div>

          {/* Primary stats */}
          <div className="flex gap-3 mb-2">
            <div className="flex items-center gap-1 text-slate-700" title="Speed over ground">
              <BoltIcon className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-sm font-semibold">{formatSpeed(ship.sog)}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-700" title="Distance to bridge">
              <MapPinIcon className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-sm font-semibold">{formatDistance(ship.distanceToBridge)}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-700" title="Estimated time to bridge">
              <ClockIcon className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-sm font-semibold">{formatETA(eta)}</span>
            </div>
          </div>

          {/* Secondary details */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 mb-1.5">
            <div className="flex items-center gap-1" title="Heading">
              <ArrowUpIcon className="w-3 h-3 text-slate-400" style={{ transform: `rotate(${headingDeg}deg)` }} />
              <span>{formatHeading(headingDeg)}</span>
            </div>
            <span title="Navigation status">{NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown"}</span>
            {ship.destination && (
              <div className="flex items-center gap-1" title="Destination">
                <FlagIcon className="w-3 h-3 text-slate-400" />
                <span>{ship.destination}</span>
              </div>
            )}
            {ship.length && ship.length > 0 && (
              <div className="flex items-center gap-1" title="Vessel dimensions">
                <ArrowsPointingOutIcon className="w-3 h-3 text-slate-400" />
                <span>{ship.length}m × {ship.width}m</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="text-[0.65rem] text-slate-500 pt-1 border-t border-slate-200 flex justify-between">
            <span title="MMSI identifier">{ship.mmsi}</span>
            <span title="Last update">{new Date(ship.lastUpdate).toLocaleTimeString()}</span>
          </div>
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
      <Marker position={[BRIDGE_CENTER.lat, BRIDGE_CENTER.lng]} icon={bridgeIcon}>
        <Popup>
          <div className="ship-popup">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="m-0! text-base font-bold text-slate-800 leading-tight">Blue Water Bridge</h3>
            </div>

            <div className="flex gap-3 mb-2">
              <div className="flex items-center gap-1 text-slate-700" title="Connects Sarnia, ON and Port Huron, MI">
                <GlobeAmericasIcon className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-sm font-semibold">Sarnia ↔ Port Huron</span>
              </div>
              <div className="flex items-center gap-1 text-slate-700" title="Air draft clearance">
                <ArrowsUpDownIcon className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-sm font-semibold">~46 m (152 ft)</span>
              </div>
            </div>

            <div className="text-[0.65rem] text-slate-500 pt-1 border-t border-slate-200">
              <span>International crossing over the St. Clair River</span>
            </div>
          </div>
        </Popup>
      </Marker>
    </>
  );
}

function FiordBaseLayer() {
  const map = useMap();
  useEffect(() => {
    const gl = L.maplibreGL({
      style: "https://tiles.openfreemap.org/styles/fiord",
      attribution:
        '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Style: <a href="https://github.com/openmaptiles/fiord-color-gl-style">Fiord Color</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC-BY 4.0</a>) | Tiles by <a href="https://openfreemap.org/">OpenFreeMap</a>',
    }).addTo(map);
    return () => {
      map.removeLayer(gl);
    };
  }, [map]);
  return null;
}

function RecenterButton() {
  const map = useMap();
  const handleRecenter = () => {
    map.setView([BRIDGE_CENTER.lat, BRIDGE_CENTER.lng], DEFAULT_ZOOM);
  };

  return (
    <button
      className="absolute top-2.5 right-2.5 z-1000 w-9 h-9 bg-slate-800 border-2 border-slate-600/40 rounded text-lg text-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      onClick={handleRecenter}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleRecenter();
        }
      }}
      aria-label="Re-center map on Blue Water Bridge"
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
        <FiordBaseLayer />
        <BridgeMarker />
        {Array.from(ships.values()).map((ship) => (
          <ShipMarker key={ship.mmsi} ship={ship} />
        ))}
        <RecenterButton />
      </MapContainer>
    </div>
  );
}
