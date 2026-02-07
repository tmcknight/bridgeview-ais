import Map, {
  Marker,
  Popup,
  NavigationControl,
  useMap,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import React, { useEffect, memo, useState, useCallback } from "react";
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
  HomeIcon,
} from "@heroicons/react/20/solid";

// Create ship icon as React element
function createShipIconElement(ship: TrackedShip): React.JSX.Element {
  const rotation = ship.trueHeading !== 511 ? ship.trueHeading : ship.cog;
  const color = ship.approaching ? "#ef4444" : "#3b82f6";
  const size = 24;

  return (
    <div className="ship-marker">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <path
          d="M12 2 L18 20 L12 16 L6 20 Z"
          fill={color}
          stroke="#fff"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

// Extracted popup content component
function ShipPopupContent({ ship }: { ship: TrackedShip }) {
  const eta = estimatedTimeToBridge(ship.distanceToBridge, ship.sog);
  const headingDeg = ship.trueHeading !== 511 ? ship.trueHeading : ship.cog;

  return (
    <div className="ship-popup">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="m-0! text-base font-bold text-slate-800 leading-tight">
          {ship.name}
        </h3>
        {ship.approaching && (
          <span className="shrink-0 text-[0.6rem] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded tracking-wide">
            APPROACHING
          </span>
        )}
      </div>

      {/* Primary stats */}
      <div className="flex gap-3 mb-2">
        <div
          className="flex items-center gap-1 text-slate-700"
          title="Speed over ground"
        >
          <BoltIcon className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-sm font-semibold">{formatSpeed(ship.sog)}</span>
        </div>
        <div
          className="flex items-center gap-1 text-slate-700"
          title="Distance to bridge"
        >
          <MapPinIcon className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-sm font-semibold">
            {formatDistance(ship.distanceToBridge)}
          </span>
        </div>
        <div
          className="flex items-center gap-1 text-slate-700"
          title="Estimated time to bridge"
        >
          <ClockIcon className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-sm font-semibold">{formatETA(eta)}</span>
        </div>
      </div>

      {/* Secondary details */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 mb-1.5">
        <div className="flex items-center gap-1" title="Heading">
          <ArrowUpIcon
            className="w-3 h-3 text-slate-400"
            style={{ transform: `rotate(${headingDeg}deg)` }}
          />
          <span>{formatHeading(headingDeg)}</span>
        </div>
        <span title="Navigation status">
          {NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown"}
        </span>
        {ship.destination && (
          <div className="flex items-center gap-1" title="Destination">
            <FlagIcon className="w-3 h-3 text-slate-400" />
            <span>{ship.destination}</span>
          </div>
        )}
        {ship.length && ship.length > 0 && (
          <div className="flex items-center gap-1" title="Vessel dimensions">
            <ArrowsPointingOutIcon className="w-3 h-3 text-slate-400" />
            <span>
              {ship.length}m × {ship.width}m
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-[0.65rem] text-slate-500 pt-1 border-t border-slate-200 flex justify-between">
        <span title="MMSI identifier">{ship.mmsi}</span>
        <span title="Last update">
          {new Date(ship.lastUpdate).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

// Memoize ShipMarker to prevent re-renders when ship data hasn't changed
const ShipMarker = memo(
  ({
    ship,
    isPopupOpen,
    onTogglePopup,
    isSelected,
  }: {
    ship: TrackedShip;
    isPopupOpen: boolean;
    onTogglePopup: () => void;
    isSelected: boolean;
  }) => {
    return (
      <>
        <Marker
          longitude={ship.longitude}
          latitude={ship.latitude}
          anchor="center"
          onClick={onTogglePopup}
          className={isSelected ? "selected-ship-marker" : ""}
        >
          {createShipIconElement(ship)}
        </Marker>
        {isPopupOpen && (
          <Popup
            longitude={ship.longitude}
            latitude={ship.latitude}
            anchor="bottom"
            offset={12}
            onClose={onTogglePopup}
            closeButton={true}
            closeOnClick={false}
          >
            <ShipPopupContent ship={ship} />
          </Popup>
        )}
      </>
    );
  },
  // Custom comparison: only re-render if ship data or popup state has changed
  (prevProps, nextProps) => {
    return (
      prevProps.ship.lastUpdate === nextProps.ship.lastUpdate &&
      prevProps.isPopupOpen === nextProps.isPopupOpen &&
      prevProps.isSelected === nextProps.isSelected
    );
  }
);

// Bridge marker as DOM marker with emoji
function BridgeMarker({
  isPopupOpen,
  onTogglePopup,
}: {
  isPopupOpen: boolean;
  onTogglePopup: () => void;
}) {
  return (
    <>
      <Marker
        longitude={BRIDGE_CENTER.lng}
        latitude={BRIDGE_CENTER.lat}
        anchor="center"
        onClick={onTogglePopup}
      >
        <div className="bridge-marker">
          <div className="bridge-icon">🌉</div>
        </div>
      </Marker>
      {isPopupOpen && (
        <Popup
          longitude={BRIDGE_CENTER.lng}
          latitude={BRIDGE_CENTER.lat}
          anchor="bottom"
          offset={16}
          onClose={onTogglePopup}
          closeButton={true}
          closeOnClick={false}
        >
          <div className="ship-popup">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="m-0! text-base font-bold text-slate-800 leading-tight">
                Blue Water Bridge
              </h3>
            </div>

            <div className="flex gap-3 mb-2">
              <div
                className="flex items-center gap-1 text-slate-700"
                title="Connects Sarnia, ON and Port Huron, MI"
              >
                <GlobeAmericasIcon className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-sm font-semibold">Sarnia ↔ Port Huron</span>
              </div>
              <div
                className="flex items-center gap-1 text-slate-700"
                title="Air draft clearance"
              >
                <ArrowsUpDownIcon className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-sm font-semibold">~46 m (152 ft)</span>
              </div>
            </div>

            <div className="text-[0.65rem] text-slate-500 pt-1 border-t border-slate-200">
              <span>International crossing over the St. Clair River</span>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
}

// Tile providers configuration (unchanged)
const TILE_PROVIDERS = {
  primary: {
    name: "OpenFreeMap Fiord",
    style: "https://tiles.openfreemap.org/styles/fiord",
  },
  fallback: {
    name: "OpenStreetMap",
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: "osm",
          type: "raster",
          source: "osm",
        },
      ],
    } as any, // Type assertion for MapLibre GL style specification
  },
};

// Custom attribution control component
function AttributionToggle() {
  const [showAttribution, setShowAttribution] = useState(false);

  return (
    <div className="absolute bottom-0 right-0 z-40 m-2.5">
      <button
        className="w-7 h-7 bg-slate-800/90 border-2 border-slate-500 rounded text-xs text-slate-100 flex items-center justify-center cursor-pointer hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        onClick={() => setShowAttribution(!showAttribution)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setShowAttribution(!showAttribution);
          }
        }}
        aria-label="Toggle map attribution"
        title="Map attribution"
      >
        ⓘ
      </button>
      {showAttribution && (
        <div className="absolute bottom-full right-0 mb-1 px-2 py-1.5 bg-slate-800/95 border border-slate-600/40 rounded text-[0.65rem] text-slate-400 max-w-xs">
          <div>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-200 underline">OpenStreetMap</a> contributors</div>
          <div className="mt-0.5">Tiles: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-200 underline">OpenFreeMap</a></div>
        </div>
      )}
    </div>
  );
}

function RecenterButton() {
  const { current: map } = useMap();

  const handleRecenter = () => {
    if (map) {
      map.flyTo({
        center: [BRIDGE_CENTER.lng, BRIDGE_CENTER.lat],
        zoom: DEFAULT_ZOOM,
        duration: 500,
      });
    }
  };

  return (
    <button
      className="maplibregl-ctrl-icon maplibregl-ctrl-recenter absolute top-[87px] right-2.5 z-40 w-7.75 h-7.75 p-0 bg-slate-600 border border-slate-400 rounded shadow-lg flex items-center justify-center cursor-pointer hover:bg-slate-500 focus:outline-none"
      onClick={handleRecenter}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleRecenter();
        }
      }}
      aria-label="Re-center map on Blue Water Bridge"
      title="Re-center on bridge"
    >
      <HomeIcon className="w-4 h-4 text-white" />
    </button>
  );
}

interface ShipMapProps {
  ships: Map<number, TrackedShip>;
  selectedShip?: TrackedShip | null;
  onSelectShip?: (ship: TrackedShip) => void;
}

function MapController({ selectedShip }: { selectedShip?: TrackedShip | null }) {
  const { current: map } = useMap();

  useEffect(() => {
    if (selectedShip && map) {
      const currentZoom = map.getZoom();
      map.flyTo({
        center: [selectedShip.longitude, selectedShip.latitude],
        zoom: Math.max(currentZoom, 13),
        duration: 800,
        essential: true,
      });
    }
  }, [map, selectedShip]);

  return null;
}

export default function ShipMap({ ships, selectedShip }: ShipMapProps) {
  const [mapStyle, setMapStyle] = useState(TILE_PROVIDERS.primary.style);
  const [errorCount, setErrorCount] = useState(0);
  const [openPopupId, setOpenPopupId] = useState<number | "bridge" | null>(null);

  const handleMapError = useCallback((e: any) => {
    const errorMsg = e.error?.message || "";
    if (
      errorMsg.includes("tile") ||
      errorMsg.includes("source") ||
      errorMsg.includes("load")
    ) {
      setErrorCount((prev) => {
        const newCount = prev + 1;
        if (newCount >= 3) {
          console.warn(
            `Failed to load tiles from ${TILE_PROVIDERS.primary.name} after ${newCount} attempts. Switching to ${TILE_PROVIDERS.fallback.name}.`
          );
          setMapStyle(TILE_PROVIDERS.fallback.style);
        }
        return newCount;
      });
    }
  }, []);

  const handleStyleLoad = useCallback(() => {
    setErrorCount(0);
  }, []);

  return (
    <div className="w-full h-full">
      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: BRIDGE_CENTER.lng,
          latitude: BRIDGE_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        mapStyle={mapStyle}
        onError={handleMapError}
        onLoad={handleStyleLoad}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <BridgeMarker
          isPopupOpen={openPopupId === "bridge"}
          onTogglePopup={() =>
            setOpenPopupId(openPopupId === "bridge" ? null : "bridge")
          }
        />
        {Array.from(ships.values()).map((ship) => (
          <ShipMarker
            key={ship.mmsi}
            ship={ship}
            isPopupOpen={openPopupId === ship.mmsi}
            isSelected={selectedShip?.mmsi === ship.mmsi}
            onTogglePopup={() =>
              setOpenPopupId(openPopupId === ship.mmsi ? null : ship.mmsi)
            }
          />
        ))}
        <MapController selectedShip={selectedShip} />
        <RecenterButton />
      </Map>
      <AttributionToggle />
    </div>
  );
}
