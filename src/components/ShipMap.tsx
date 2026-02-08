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
import type { Theme } from "../hooks/useTheme";
import {
  BRIDGE_CENTER,
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
} from "../constants/bridge";
import {
  GlobeAmericasIcon,
  ArrowsUpDownIcon,
  HomeIcon,
  InformationCircleIcon,
  CubeIcon,
  ArrowUpIcon,
} from "@heroicons/react/20/solid";

// Create ship icon as React element
function getShipRotation(ship: TrackedShip): number {
  return ship.trueHeading !== 511 ? ship.trueHeading : ship.cog;
}

function createShipIconElement(ship: TrackedShip): React.JSX.Element {
  const isStationary = ship.navStatus === 1 || ship.navStatus === 5; // anchored or moored
  const color = ship.approaching ? "#ef4444" : isStationary ? "#9ca3af" : "#3b82f6";
  const size = 24;

  return (
    <div className="ship-marker">
      <svg width={size} height={size} viewBox="0 0 24 24">
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
  return (
    <div className="ship-popup">
      <h3 className="m-0! text-xs font-bold text-slate-800 leading-tight">
        {ship.name}
      </h3>
    </div>
  );
}

// Memoize ShipMarker to prevent re-renders when ship data hasn't changed
const ShipMarker = memo(
  ({
    ship,
    isPopupOpen,
    onTogglePopup,
    onSelectShip,
    isSelected,
    is3D,
  }: {
    ship: TrackedShip;
    isPopupOpen: boolean;
    onTogglePopup: () => void;
    onSelectShip?: (ship: TrackedShip) => void;
    isSelected: boolean;
    is3D: boolean;
  }) => {
    const handleClick = useCallback((e: any) => {
      e.originalEvent.stopPropagation();
      onTogglePopup();
      onSelectShip?.(ship);
    }, [onTogglePopup, onSelectShip, ship]);

    return (
      <>
        <Marker
          longitude={ship.longitude}
          latitude={ship.latitude}
          anchor="center"
          onClick={handleClick}
          className={isSelected ? "selected-ship-marker" : ""}
          rotation={getShipRotation(ship)}
          rotationAlignment="map"
          pitchAlignment={is3D ? "map" : "viewport"}
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
            closeButton={false}
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
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.is3D === nextProps.is3D
    );
  }
);

// Bridge marker as DOM marker with emoji
function BridgeMarker({
  isPopupOpen,
  onTogglePopup,
  onSelect,
}: {
  isPopupOpen: boolean;
  onTogglePopup: () => void;
  onSelect?: () => void;
}) {
  const handleClick = useCallback((e: any) => {
    e.originalEvent.stopPropagation();
    onTogglePopup();
    onSelect?.();
  }, [onTogglePopup, onSelect]);

  return (
    <>
      <Marker
        longitude={BRIDGE_CENTER.lng}
        latitude={BRIDGE_CENTER.lat}
        anchor="center"
        onClick={handleClick}
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
          closeButton={false}
          closeOnClick={false}
        >
          <div className="ship-popup">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="m-0! text-base font-bold text-slate-800 leading-tight">
                Blue Water Bridge
              </h3>
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
              <div
                className="flex items-center gap-1 text-slate-700 whitespace-nowrap leading-none"
                title="Connects Sarnia, ON and Port Huron, MI"
              >
                <GlobeAmericasIcon className="shrink-0 w-3.5 h-3.5 text-blue-500" />
                <span className="text-sm font-semibold leading-none">Sarnia ↔ Port Huron</span>
              </div>
              <div
                className="flex items-center gap-1 text-slate-700 whitespace-nowrap leading-none"
                title="Air draft clearance"
              >
                <ArrowsUpDownIcon className="shrink-0 w-3.5 h-3.5 text-amber-500" />
                <span className="text-sm font-semibold leading-none">~46 m (152 ft)</span>
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

// Tile providers configuration
const TILE_PROVIDERS = {
  dark: {
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
      } as any,
    },
  },
  light: {
    primary: {
      name: "OpenFreeMap Bright",
      style: "https://tiles.openfreemap.org/styles/bright",
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
      } as any,
    },
  },
};

// Custom attribution control component
function AttributionToggle({ theme }: { theme: Theme }) {
  const [showAttribution, setShowAttribution] = useState(false);

  return (
    <div className={`absolute bottom-2.5 right-2.5 z-40 ${theme === 'dark' ? 'dark' : ''}`}>
      {showAttribution && (
        <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1.5 px-2 py-1.5 bg-white/95 dark:bg-slate-800/95 border border-slate-300/40 dark:border-slate-600/40 rounded text-[0.65rem] text-slate-600 dark:text-slate-400 whitespace-nowrap">
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline">OpenStreetMap</a> contributors · Tiles: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer" className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline">OpenFreeMap</a>
        </div>
      )}
      <button
        className="w-7.75 h-7.75 p-0 bg-slate-100 dark:bg-slate-600 border border-slate-300 dark:border-slate-400 rounded shadow-lg flex items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-500 focus:outline-none"
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
        <InformationCircleIcon className="w-4 h-4 text-slate-700 dark:text-white" />
      </button>
    </div>
  );
}

const MAP_BTN = "w-[29px] h-[29px] p-0 flex items-center justify-center cursor-pointer focus:outline-none bg-slate-100 dark:bg-slate-600 hover:bg-slate-200 dark:hover:bg-slate-500";
const MAP_BTN_3D_ACTIVE = "w-[29px] h-[29px] p-0 flex items-center justify-center cursor-pointer focus:outline-none bg-blue-500 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-700";

function MapControlGroup({
  theme,
  is3D,
  onToggle3D,
  bearing,
}: {
  theme: Theme;
  is3D: boolean;
  onToggle3D: (next: boolean) => void;
  bearing: number;
}) {
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

  const handleToggle3D = () => {
    if (!map) return;
    const next = !is3D;
    onToggle3D(next);

    if (next) {
      map.easeTo({ pitch: 60, duration: 500 });
      const mapInstance = map.getMap();
      if (!mapInstance.getLayer("3d-buildings")) {
        const style = mapInstance.getStyle();
        const buildingLayer = style?.layers?.find(
          (l: any) =>
            l.id.includes("building") &&
            l.type === "fill" &&
            !l.id.includes("3d-buildings")
        );
        if (buildingLayer) {
          mapInstance.addLayer({
            id: "3d-buildings",
            source: (buildingLayer as any).source,
            "source-layer": (buildingLayer as any)["source-layer"],
            type: "fill-extrusion",
            minzoom: 13,
            paint: {
              "fill-extrusion-color": theme === "dark" ? "#475569" : "#cbd5e1",
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                13,
                0,
                15,
                ["coalesce", ["get", "render_height"], ["get", "height"], 10],
              ],
              "fill-extrusion-base": [
                "coalesce",
                ["get", "render_min_height"],
                ["get", "min_height"],
                0,
              ],
              "fill-extrusion-opacity": 0.7,
            },
          } as any);
        }
      }
    } else {
      map.easeTo({ pitch: 0, duration: 500 });
      const mapInstance = map.getMap();
      if (mapInstance.getLayer("3d-buildings")) {
        mapInstance.removeLayer("3d-buildings");
      }
    }
  };

  const handleResetNorth = () => {
    if (map) {
      map.easeTo({ bearing: 0, duration: 500 });
    }
  };

  return (
    <div className={`absolute top-[87px] right-2.5 z-40 ${theme === "dark" ? "dark" : ""}`}>
      <div className="flex flex-col rounded border border-slate-300 dark:border-slate-400 shadow-lg overflow-hidden divide-y divide-slate-300 dark:divide-slate-400">
        <button
          className={MAP_BTN}
          onClick={handleRecenter}
          aria-label="Re-center map on Blue Water Bridge"
          title="Re-center on bridge"
        >
          <HomeIcon className="w-3.5 h-3.5 text-slate-700 dark:text-white" />
        </button>
        <button
          className={is3D ? MAP_BTN_3D_ACTIVE : MAP_BTN}
          onClick={handleToggle3D}
          aria-label="Toggle 3D map view"
          title={is3D ? "Switch to 2D view" : "Switch to 3D view"}
        >
          <CubeIcon
            className={`w-3.5 h-3.5 ${is3D ? "text-white" : "text-slate-700 dark:text-white"}`}
          />
        </button>
        <button
          className={MAP_BTN}
          onClick={handleResetNorth}
          aria-label="Reset map to face north"
          title="Reset north"
        >
          <ArrowUpIcon
            className="w-3.5 h-3.5 text-slate-700 dark:text-white transition-transform duration-200"
            style={{ transform: `rotate(${-bearing}deg)` }}
          />
        </button>
      </div>
    </div>
  );
}

interface ShipMapProps {
  ships: Map<number, TrackedShip>;
  selectedShip?: TrackedShip | null;
  onSelectShip?: (ship: TrackedShip) => void;
  theme: Theme;
}

function MapController({
  selectedShip,
  isBridgeSelected,
}: {
  selectedShip?: TrackedShip | null;
  isBridgeSelected: boolean;
}) {
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

  useEffect(() => {
    if (isBridgeSelected && map) {
      map.flyTo({
        center: [BRIDGE_CENTER.lng, BRIDGE_CENTER.lat],
        zoom: DEFAULT_ZOOM,
        duration: 800,
        essential: true,
      });
    }
  }, [map, isBridgeSelected]);

  return null;
}

export default function ShipMap({ ships, selectedShip, onSelectShip, theme }: ShipMapProps) {
  const [mapStyle, setMapStyle] = useState(TILE_PROVIDERS[theme].primary.style);
  const [errorCount, setErrorCount] = useState(0);
  const [openPopupId, setOpenPopupId] = useState<number | "bridge" | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [bearing, setBearing] = useState(0);

  // Update map style when theme changes
  useEffect(() => {
    setMapStyle(TILE_PROVIDERS[theme].primary.style);
    setErrorCount(0);
  }, [theme]);

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
          const provider = TILE_PROVIDERS[theme];
          console.warn(
            `Failed to load tiles from ${provider.primary.name} after ${newCount} attempts. Switching to ${provider.fallback.name}.`
          );
          setMapStyle(provider.fallback.style);
        }
        return newCount;
      });
    }
  }, [theme]);

  const handleStyleLoad = useCallback(() => {
    setErrorCount(0);
  }, []);

  const handleMapClick = useCallback(() => {
    setOpenPopupId(null);
  }, []);

  const handleMove = useCallback((e: { viewState: { pitch: number; bearing: number } }) => {
    setBearing(e.viewState.bearing);
  }, []);

  const handleMoveEnd = useCallback((e: { viewState: { pitch: number; bearing: number } }) => {
    setIs3D(e.viewState.pitch > 0);
    setBearing(e.viewState.bearing);
  }, []);

  // Open popup when ship is selected from list
  useEffect(() => {
    if (selectedShip) {
      setOpenPopupId(selectedShip.mmsi);
    }
  }, [selectedShip]);

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
        onClick={handleMapClick}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <BridgeMarker
          isPopupOpen={openPopupId === "bridge"}
          onTogglePopup={() =>
            setOpenPopupId(openPopupId === "bridge" ? null : "bridge")
          }
          onSelect={() => onSelectShip?.(null as any)}
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
            onSelectShip={onSelectShip}
            is3D={is3D}
          />
        ))}
        <MapController
          selectedShip={selectedShip}
          isBridgeSelected={openPopupId === "bridge"}
        />
        <MapControlGroup theme={theme} is3D={is3D} onToggle3D={setIs3D} bearing={bearing} />
      </Map>
      <AttributionToggle theme={theme} />
    </div>
  );
}
