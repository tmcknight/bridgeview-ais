import Map, {
  Marker,
  Popup,
  Source,
  Layer,
  NavigationControl,
  useMap,
} from "react-map-gl/maplibre";
import type { MapRef, MarkerEvent, MapLayerMouseEvent, ErrorEvent as MapErrorEvent, StyleSpecification, LayerSpecification } from "react-map-gl/maplibre";
import type { AddLayerObject } from "maplibre-gl";
import type { FeatureCollection, Point, Polygon } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import React, { useEffect, useLayoutEffect, useRef, memo, useState, useCallback, useMemo } from "react";
import type { TrackedShip } from "../types/ais";
import type { Aircraft } from "../types/aircraft";
import { aircraftLabel, formatAltitude, isRotorcraft, verticalTrend } from "../utils/aircraft";
import type { Theme } from "../hooks/useTheme";
import SourceBadge from "./SourceBadge";
import MovingMarker from "./MovingMarker";
import type { ShipCamSize } from "./ShipCam";
import { hullOutline, hasHull, metresPerPixel } from "../utils/hull";
import {
  AIRCRAFT_MAX_AGE_MS,
  SHIP_MAX_AGE_MS,
  aircraftFix,
  motionAt,
  motionSettled,
  sameFix,
  shipFix,
  shipRotation,
  startMotion,
  type Motion,
  type MotionPosition,
} from "../utils/motion";
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
  ListBulletIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/20/solid";

const HIDE_CLASS_B_KEY = "hideClassB";

function getStoredHideClassB(): boolean {
  try {
    return localStorage.getItem(HIDE_CLASS_B_KEY) === "true";
  } catch {
    // localStorage might not be available
    return false;
  }
}

function setStoredHideClassB(hide: boolean): void {
  try {
    localStorage.setItem(HIDE_CLASS_B_KEY, String(hide));
  } catch {
    // localStorage might not be available
  }
}

const SHOW_AIRCRAFT_KEY = "showAircraft";

function getStoredShowAircraft(): boolean {
  try {
    return localStorage.getItem(SHOW_AIRCRAFT_KEY) !== "false";
  } catch {
    // localStorage might not be available
    return true;
  }
}

function setStoredShowAircraft(show: boolean): void {
  try {
    localStorage.setItem(SHOW_AIRCRAFT_KEY, String(show));
  } catch {
    // localStorage might not be available
  }
}

function getShipColor(ship: TrackedShip): string {
  const isStationary = ship.navStatus === 1 || ship.navStatus === 5; // anchored or moored
  return ship.approaching ? "#ef4444" : isStationary ? "#9ca3af" : "#3b82f6";
}

function createShipIconElement(ship: TrackedShip): React.JSX.Element {
  const color = getShipColor(ship);
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
      <div className="mt-0.5 text-[0.65rem] text-slate-500">
        <SourceBadge source={ship.source} signalPower={ship.signalPower} />
      </div>
    </div>
  );
}

// Closer than this, ships whose measurements are known are drawn as hulls instead of arrows
const HULL_MIN_ZOOM = 11;
// Hulls never shrink below the arrow's size, so small or distant ships stay visible
const HULL_MIN_LENGTH_PX = 24;
const HULL_MIN_BEAM_PX = 6;

function showsHull(ship: TrackedShip, zoom: number): boolean {
  return zoom >= HULL_MIN_ZOOM && hasHull(ship.dimensions);
}

interface HullFeatures {
  hulls: FeatureCollection<Polygon>;
  /** The selected ship's centre, with the ripple's starting radius in pixels */
  ripple: FeatureCollection<Point>;
}

// Hull outlines: true to scale when zoomed in, blown up to a minimum size further out
function buildHullFeatures(
  ships: Map<number, TrackedShip>,
  zoom: number,
  position: (ship: TrackedShip) => MotionPosition,
  selectedMmsi?: number
): HullFeatures {
  const hulls: FeatureCollection<Polygon>["features"] = [];
  const ripple: FeatureCollection<Point>["features"] = [];
  for (const ship of ships.values()) {
    if (!showsHull(ship, zoom)) continue;
    const { lat, lon, rotation } = position(ship);
    const mpp = metresPerPixel(zoom, lat);
    const outline = hullOutline(
      lat,
      lon,
      rotation,
      ship.dimensions!,
      HULL_MIN_LENGTH_PX * mpp,
      HULL_MIN_BEAM_PX * mpp
    );
    if (!outline) continue;
    hulls.push({
      type: "Feature",
      properties: { mmsi: ship.mmsi, color: getShipColor(ship) },
      geometry: { type: "Polygon", coordinates: [outline] },
    });
    if (ship.mmsi === selectedMmsi) {
      // Halfway between the middle of the stern and the bow tip
      const [sternPort, sternStarboard, , bow] = outline;
      const centre: [number, number] = [
        ((sternPort[0] + sternStarboard[0]) / 2 + bow[0]) / 2,
        ((sternPort[1] + sternStarboard[1]) / 2 + bow[1]) / 2,
      ];
      const { toBow, toStern } = ship.dimensions!;
      const lengthPx = Math.max((toBow + toStern) / mpp, HULL_MIN_LENGTH_PX);
      ripple.push({
        type: "Feature",
        properties: { baseRadius: lengthPx / 2 },
        geometry: { type: "Point", coordinates: centre },
      });
    }
  }
  return {
    hulls: { type: "FeatureCollection", features: hulls },
    ripple: { type: "FeatureCollection", features: ripple },
  };
}

const HULL_FILL_LAYER = "ship-hulls-fill";
// Invisible band around each hull, so thin hulls are easy to click
const HULL_HIT_LAYER = "ship-hulls-hit";
const HULL_INTERACTIVE_LAYERS = [HULL_FILL_LAYER, HULL_HIT_LAYER];
const HULL_RIPPLE_LAYER = "ship-hulls-ripple";
// Same rhythm as the selected arrow's pulse-selected animation
const HULL_RIPPLE_MS = 1500;
// How far past the hull the ring travels before it fades out
const HULL_RIPPLE_SPREAD_PX = 20;

// A ring that grows out from the selected hull and fades, over and over
function useHullRipple(active: boolean): void {
  const { current: map } = useMap();

  useEffect(() => {
    if (!map || !active) return;
    const mapInstance = map.getMap();
    let frame = requestAnimationFrame(function step(now) {
      const t = (now % HULL_RIPPLE_MS) / HULL_RIPPLE_MS;
      const eased = 1 - (1 - t) ** 2; // fast out, slowing as it fades
      // The layer is briefly missing while the map style reloads
      if (mapInstance.getLayer(HULL_RIPPLE_LAYER)) {
        mapInstance.setPaintProperty(HULL_RIPPLE_LAYER, "circle-radius", [
          "+",
          ["get", "baseRadius"],
          4 + HULL_RIPPLE_SPREAD_PX * eased,
        ]);
        mapInstance.setPaintProperty(HULL_RIPPLE_LAYER, "circle-stroke-opacity", 1 - t);
      }
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [map, active]);
}

const EMPTY_FEATURES: FeatureCollection = { type: "FeatureCollection", features: [] };

function ShipHulls({
  ships,
  zoom,
  selectedMmsi,
}: {
  ships: Map<number, TrackedShip>;
  zoom: number;
  selectedMmsi?: number;
}) {
  const { current: map } = useMap();
  const motionsRef = useRef(new globalThis.Map<number, Motion>());

  // Before paint, so a new report never shows for a frame at its raw position
  useLayoutEffect(() => {
    const motions = motionsRef.current;
    const now = performance.now();
    for (const ship of ships.values()) {
      const fix = shipFix(ship);
      const prev = motions.get(ship.mmsi);
      if (!prev || !sameFix(prev.fix, fix)) {
        motions.set(ship.mmsi, startMotion(prev, fix, now, SHIP_MAX_AGE_MS));
      }
    }
    for (const mmsi of motions.keys()) {
      if (!ships.has(mmsi)) motions.delete(mmsi);
    }
  }, [ships]);

  // The sources' data is set here every frame while hulls are moving, not from props
  useEffect(() => {
    if (!map) return;
    const mapInstance = map.getMap();
    const motions = motionsRef.current;
    let drawn = false;
    // A new map style brings the sources back empty
    const redraw = () => {
      drawn = false;
    };
    mapInstance.on("styledata", redraw);
    let frame = requestAnimationFrame(function step(now) {
      const moving = Array.from(ships.values()).some((ship) => {
        const motion = motions.get(ship.mmsi);
        return showsHull(ship, zoom) && motion !== undefined && !motionSettled(motion, now);
      });
      const hullSource = mapInstance.getSource<maplibregl.GeoJSONSource>("ship-hulls");
      const rippleSource = mapInstance.getSource<maplibregl.GeoJSONSource>("ship-hull-ripple");
      if ((!drawn || moving) && hullSource && rippleSource) {
        const { hulls, ripple } = buildHullFeatures(
          ships,
          zoom,
          (ship) => {
            const motion = motions.get(ship.mmsi);
            return motion ? motionAt(motion, now) : { lat: ship.latitude, lon: ship.longitude, rotation: shipRotation(ship) };
          },
          selectedMmsi
        );
        hullSource.setData(hulls);
        rippleSource.setData(ripple);
        drawn = true;
      }
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      mapInstance.off("styledata", redraw);
    };
  }, [map, ships, zoom, selectedMmsi]);

  const selected = selectedMmsi !== undefined ? ships.get(selectedMmsi) : undefined;
  useHullRipple(selected !== undefined && showsHull(selected, zoom));
  return (
    <>
      <Source id="ship-hulls" type="geojson" data={EMPTY_FEATURES}>
        <Layer
          id={HULL_FILL_LAYER}
          type="fill"
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": 0.85,
          }}
        />
        <Layer
          id="ship-hulls-outline"
          type="line"
          paint={{
            "line-color": "#fff",
            "line-width": 1.5,
          }}
        />
        <Layer
          id={HULL_HIT_LAYER}
          type="line"
          paint={{
            "line-color": "transparent",
            "line-width": 16,
          }}
        />
      </Source>
      <Source id="ship-hull-ripple" type="geojson" data={EMPTY_FEATURES}>
        <Layer
          id={HULL_RIPPLE_LAYER}
          type="circle"
          paint={{
            "circle-color": "transparent",
            "circle-radius": ["get", "baseRadius"],
            "circle-stroke-color": "#3b82f6",
            "circle-stroke-width": 2,
            "circle-pitch-alignment": "map",
          }}
        />
      </Source>
    </>
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
    showArrow,
  }: {
    ship: TrackedShip;
    isPopupOpen: boolean;
    onTogglePopup: () => void;
    onSelectShip?: (ship: TrackedShip) => void;
    isSelected: boolean;
    is3D: boolean;
    /** False while the ship is drawn as a hull; the marker then only anchors its popup */
    showArrow: boolean;
  }) => {
    const handleClick = useCallback((e: MouseEvent) => {
      e.stopPropagation();
      onTogglePopup();
      onSelectShip?.(ship);
    }, [onTogglePopup, onSelectShip, ship]);

    return (
      <MovingMarker
        fix={shipFix(ship)}
        maxAgeMs={SHIP_MAX_AGE_MS}
        onClick={handleClick}
        className={isSelected ? "selected-ship-marker" : undefined}
        pitchAlignment={is3D ? "map" : "viewport"}
        popup={isPopupOpen && <ShipPopupContent ship={ship} />}
      >
        {/* While the ship is drawn as a hull, the marker only anchors its popup */}
        {showArrow && createShipIconElement(ship)}
      </MovingMarker>
    );
  },
  // Custom comparison: only re-render if ship data or popup state has changed
  (prevProps, nextProps) => {
    return (
      prevProps.ship.lastUpdate === nextProps.ship.lastUpdate &&
      prevProps.isPopupOpen === nextProps.isPopupOpen &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.is3D === nextProps.is3D &&
      prevProps.showArrow === nextProps.showArrow
    );
  }
);

// Amber in the air, grey on the ground, so planes stand apart from the blue ships
function getAircraftColor(aircraft: Aircraft): string {
  return aircraft.onGround ? "#9ca3af" : "#f59e0b";
}

// Top-down helicopter, nose up: rotor blades behind a solid cabin, tail boom and tail rotor
function HelicopterIcon({ color }: { color: string }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24">
      <g strokeLinecap="round">
        <path d="M4.5 2.5 L19.5 15.5 M19.5 2.5 L4.5 15.5" stroke="#fff" strokeWidth="3" />
        <path d="M4.5 2.5 L19.5 15.5 M19.5 2.5 L4.5 15.5" stroke={color} strokeWidth="1.5" />
      </g>
      <g stroke="#fff" strokeWidth="1" fill={color}>
        <rect x="10.75" y="13" width="2.5" height="8" rx="1" />
        <rect x="8.5" y="19.5" width="7" height="2.5" rx="1" />
        <ellipse cx="12" cy="9" rx="4" ry="5.5" />
      </g>
    </svg>
  );
}

function AircraftPopupContent({ aircraft }: { aircraft: Aircraft }) {
  const altitude = formatAltitude(aircraft);
  // The registration, unless it is already the title
  const registration = aircraft.registration !== aircraftLabel(aircraft) && aircraft.registration;
  const details = [aircraft.type, registration].filter(Boolean).join(" · ");
  const motion = [
    altitude && `${altitude} ${verticalTrend(aircraft)}`.trim(),
    aircraft.speed !== undefined && `${aircraft.speed} kn`,
  ].filter(Boolean).join(" · ");
  return (
    <div className="ship-popup">
      <h3 className="m-0! text-xs font-bold text-slate-800 leading-tight">
        {aircraftLabel(aircraft)}
      </h3>
      {details && <div className="mt-0.5 text-[0.65rem] text-slate-600">{details}</div>}
      {motion && <div className="mt-0.5 text-[0.65rem] text-slate-600">{motion}</div>}
      <a
        href={`https://globe.adsb.fi/?icao=${aircraft.hex}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block text-[0.65rem] text-blue-600 hover:text-blue-700 underline"
      >
        Track on adsb.fi
      </a>
    </div>
  );
}

const AircraftMarker = memo(
  ({
    aircraft,
    isPopupOpen,
    onTogglePopup,
    is3D,
  }: {
    aircraft: Aircraft;
    isPopupOpen: boolean;
    onTogglePopup: (hex: string) => void;
    is3D: boolean;
  }) => {
    const handleClick = useCallback((e: MouseEvent) => {
      e.stopPropagation();
      onTogglePopup(aircraft.hex);
    }, [onTogglePopup, aircraft.hex]);

    return (
      <MovingMarker
        fix={aircraftFix(aircraft)}
        maxAgeMs={AIRCRAFT_MAX_AGE_MS}
        onClick={handleClick}
        pitchAlignment={is3D ? "map" : "viewport"}
        popup={isPopupOpen && <AircraftPopupContent aircraft={aircraft} />}
      >
        <div className="aircraft-marker" title={aircraftLabel(aircraft)}>
          {isRotorcraft(aircraft) ? (
            <HelicopterIcon color={getAircraftColor(aircraft)} />
          ) : (
            <svg width={20} height={20} viewBox="0 0 24 24">
              {/* Material Design "flight" icon, nose up */}
              <path
                d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
                fill={getAircraftColor(aircraft)}
                stroke="#fff"
                strokeWidth="1"
              />
            </svg>
          )}
        </div>
      </MovingMarker>
    );
  },
  // The whole list is replaced on every poll, so compare what the marker shows
  (prevProps, nextProps) => {
    const prev = prevProps.aircraft;
    const next = nextProps.aircraft;
    return (
      prev.lat === next.lat &&
      prev.lon === next.lon &&
      prev.track === next.track &&
      prev.altitude === next.altitude &&
      prev.onGround === next.onGround &&
      prev.speed === next.speed &&
      prev.verticalRate === next.verticalRate &&
      prev.callsign === next.callsign &&
      prev.category === next.category &&
      prevProps.isPopupOpen === nextProps.isPopupOpen &&
      prevProps.onTogglePopup === nextProps.onTogglePopup &&
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
  const handleClick = useCallback((e: MarkerEvent<MouseEvent>) => {
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
          <div className="bridge-popup min-w-55">
            <div className="mb-2.5 pb-2 border-b border-slate-200">
              <h3 className="m-0! text-base font-bold text-slate-800 leading-none">
                Blue Water Bridge
              </h3>
              <span className="mt-1 block text-[0.65rem] text-slate-500 leading-none">
                International Crossing
              </span>
            </div>

            <div className="space-y-1.5 mb-2.5">
              <div
                className="flex items-center gap-2 text-slate-700"
                title="Connects Sarnia, ON and Port Huron, MI"
              >
                <GlobeAmericasIcon className="shrink-0 w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs leading-none">
                  <span className="font-semibold">Sarnia, ON</span>
                  <span className="text-slate-400 mx-1">↔</span>
                  <span className="font-semibold">Port Huron, MI</span>
                </span>
              </div>
              <div
                className="flex items-center gap-2 text-slate-700"
                title="Air draft clearance"
              >
                <ArrowsUpDownIcon className="shrink-0 w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs leading-none">
                  Clearance: <span className="font-semibold">~46 m</span>
                  <span className="text-slate-400 ml-1">(152 ft)</span>
                </span>
              </div>
              <div
                className="flex items-center gap-2 text-slate-700"
                title="Waterway"
              >
                <InformationCircleIcon className="shrink-0 w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs leading-none">St. Clair River</span>
              </div>
            </div>

            <div className="text-[0.6rem] text-slate-400 pt-1.5 border-t border-slate-200 leading-tight">
              {BRIDGE_CENTER.lat.toFixed(4)}°N, {Math.abs(BRIDGE_CENTER.lng).toFixed(4)}°W
            </div>
          </div>
        </Popup>
      )}
    </>
  );
}

// Padding to offset map center for the ship list panel overlay
// Space between the ship cam and the map's centre area: its 10px inset plus
// breathing room
const SHIP_CAM_GAP = 20;
// Smallest open strip of map to keep when the panels crowd a phone screen
const MIN_OPEN_HEIGHT = 100;

function getMapPadding(
  map: MapRef | undefined,
  showShipList: boolean,
  shipCam: ShipCamSize | null,
) {
  const padding = { top: 0, bottom: 0, left: 0, right: 0 };
  const desktop = window.innerWidth >= 768;
  if (showShipList) {
    // w-95 = 380px on md+ screens; bottom half on mobile
    if (desktop) padding.right = 460;
    else padding.bottom = window.innerHeight * 0.5;
  }
  if (!shipCam || !map) return padding;

  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!desktop) {
    // Full width along the top on phones
    padding.top = Math.max(
      0,
      Math.min(shipCam.height + SHIP_CAM_GAP, height - padding.bottom - MIN_OPEN_HEIGHT),
    );
    return padding;
  }
  // The cam sits in the bottom-left corner: keep clear of it on whichever
  // side leaves more of the map open
  const camWidth = shipCam.width + SHIP_CAM_GAP;
  const camHeight = shipCam.height + SHIP_CAM_GAP;
  const openWidth = width - padding.right;
  if ((openWidth - camWidth) * height > openWidth * (height - camHeight)) {
    padding.left = Math.min(camWidth, Math.max(0, openWidth - MIN_OPEN_HEIGHT));
  } else {
    padding.bottom = Math.min(camHeight, Math.max(0, height - MIN_OPEN_HEIGHT));
  }
  return padding;
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
      } as StyleSpecification,
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
      } as StyleSpecification,
    },
  },
};

// Custom attribution control component
function AttributionToggle({ theme, showShipList }: { theme: Theme; showShipList: boolean }) {
  const [showAttribution, setShowAttribution] = useState(false);

  return (
    <div className={`absolute bottom-2.5 right-2.5 z-50 ${theme === 'dark' ? 'dark' : ''} transition-[right] duration-300 ease-in-out ${showShipList ? 'md:right-100' : ''}`}>
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
  showShipList,
  onToggleShipList,
  shipCamSize,
  hideClassB,
  onToggleClassB,
  showAircraft,
  onToggleAircraft,
}: {
  theme: Theme;
  is3D: boolean;
  onToggle3D: (next: boolean) => void;
  bearing: number;
  showShipList: boolean;
  onToggleShipList: () => void;
  shipCamSize: ShipCamSize | null;
  hideClassB: boolean;
  onToggleClassB: () => void;
  showAircraft: boolean;
  onToggleAircraft: () => void;
}) {
  const { current: map } = useMap();

  const handleRecenter = () => {
    if (map) {
      map.flyTo({
        center: [BRIDGE_CENTER.lng, BRIDGE_CENTER.lat],
        zoom: DEFAULT_ZOOM,
        duration: 500,
        padding: getMapPadding(map, showShipList, shipCamSize),
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
          (l: LayerSpecification) =>
            l.id.includes("building") &&
            l.type === "fill" &&
            !l.id.includes("3d-buildings")
        );
        if (buildingLayer && "source" in buildingLayer) {
          mapInstance.addLayer({
            id: "3d-buildings",
            source: buildingLayer.source,
            "source-layer": "source-layer" in buildingLayer ? (buildingLayer["source-layer"] as string) : undefined,
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
          } as AddLayerObject);
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
    <div className={`absolute top-[87px] right-2.5 z-50 ${theme === "dark" ? "dark" : ""} transition-[right] duration-300 ease-in-out ${showShipList ? "md:right-100" : ""}`}>
      <div className="flex flex-col gap-2">
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
          <button
            className={hideClassB ? MAP_BTN : MAP_BTN_3D_ACTIVE}
            onClick={onToggleClassB}
            aria-label="Show Class B vessels"
            aria-pressed={!hideClassB}
            title={hideClassB ? "Show Class B vessels (small craft)" : "Hide Class B vessels (small craft)"}
          >
            <span className={`text-xs font-bold ${hideClassB ? "text-slate-700 dark:text-white" : "text-white"}`}>
              B
            </span>
          </button>
          <button
            className={showAircraft ? MAP_BTN_3D_ACTIVE : MAP_BTN}
            onClick={onToggleAircraft}
            aria-label="Show aircraft"
            aria-pressed={showAircraft}
            title={showAircraft ? "Hide aircraft" : "Show aircraft"}
          >
            <PaperAirplaneIcon
              className={`w-3.5 h-3.5 -rotate-45 ${showAircraft ? "text-white" : "text-slate-700 dark:text-white"}`}
            />
          </button>
        </div>
        <button
          className={`${MAP_BTN} rounded border border-slate-300 dark:border-slate-400 shadow-lg transition-opacity duration-300 ${showShipList ? "opacity-0 pointer-events-none" : "opacity-100"}`}
          onClick={onToggleShipList}
          aria-label="Show vessel list"
          title="Show vessel list"
          tabIndex={showShipList ? -1 : undefined}
        >
          <ListBulletIcon
            className="w-3.5 h-3.5 text-slate-700 dark:text-white"
          />
        </button>
      </div>
    </div>
  );
}

interface ShipMapProps {
  ships: Map<number, TrackedShip>;
  aircraft?: Aircraft[];
  selectedShip?: TrackedShip | null;
  onSelectShip?: (ship: TrackedShip | null) => void;
  theme: Theme;
  showShipList: boolean;
  onToggleShipList: () => void;
  shipCamSize?: ShipCamSize | null;
}

function MapController({
  selectedShip,
  ships,
  isBridgeSelected,
  showShipList,
  shipCamSize,
}: {
  selectedShip?: TrackedShip | null;
  ships: Map<number, TrackedShip>;
  isBridgeSelected: boolean;
  showShipList: boolean;
  shipCamSize: ShipCamSize | null;
}) {
  const { current: map } = useMap();
  const liveShip = selectedShip ? ships.get(selectedShip.mmsi) : null;
  const followedMmsi = liveShip?.mmsi;

  // The selected ship's motion, matching its marker's
  const motionRef = useRef<{ mmsi: number; motion: Motion } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!liveShip) {
      motionRef.current = undefined;
      return;
    }
    const fix = shipFix(liveShip);
    const prev = motionRef.current?.mmsi === liveShip.mmsi ? motionRef.current.motion : undefined;
    if (!prev || !sameFix(prev.fix, fix)) {
      motionRef.current = { mmsi: liveShip.mmsi, motion: startMotion(prev, fix, performance.now(), SHIP_MAX_AGE_MS) };
    }
  }, [liveShip]);

  // Ease to the ship when it's selected, then keep it centred as it glides, until the map is dragged away
  useEffect(() => {
    const followed = motionRef.current;
    if (followedMmsi === undefined || !map || !followed) return;
    const start = motionAt(followed.motion, performance.now());
    map.easeTo({
      center: [start.lon, start.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 500,
      essential: true,
      padding: getMapPadding(map, showShipList, shipCamSize),
    });

    const mapInstance = map.getMap();
    let following = true;
    const stopFollowing = () => {
      following = false;
    };
    mapInstance.on("dragstart", stopFollowing);
    let frame = requestAnimationFrame(function step(now) {
      const motion = motionRef.current?.motion;
      // Leave the camera alone while it's easing, or while someone is zooming or rotating it
      if (following && motion && !mapInstance.isMoving()) {
        const { lat, lon } = motionAt(motion, now);
        const center = mapInstance.getCenter();
        if (center.lat !== lat || center.lng !== lon) mapInstance.jumpTo({ center: [lon, lat] });
      }
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      mapInstance.off("dragstart", stopFollowing);
    };
  }, [map, followedMmsi, showShipList, shipCamSize]);

  useEffect(() => {
    if (isBridgeSelected && map) {
      map.flyTo({
        center: [BRIDGE_CENTER.lng, BRIDGE_CENTER.lat],
        zoom: DEFAULT_ZOOM,
        duration: 800,
        essential: true,
        padding: getMapPadding(map, showShipList, shipCamSize),
      });
    }
  }, [map, isBridgeSelected, showShipList, shipCamSize]);

  // Adjust map padding when the ship list or ship cam opens, closes or resizes
  useEffect(() => {
    if (map) {
      map.easeTo({
        padding: getMapPadding(map, showShipList, shipCamSize),
        duration: 300,
      });
    }
  }, [map, showShipList, shipCamSize]);

  return null;
}

export default function ShipMap({ ships, aircraft = [], selectedShip, onSelectShip, theme, showShipList, onToggleShipList, shipCamSize = null }: ShipMapProps) {
  const [errorCount, setErrorCount] = useState(0);
  // A ship's MMSI, the bridge, or an aircraft's ICAO address
  const [openPopupId, setOpenPopupId] = useState<number | "bridge" | `aircraft:${string}` | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [hideClassB, setHideClassB] = useState(getStoredHideClassB);

  const toggleClassB = useCallback(() => {
    setHideClassB(!hideClassB);
    setStoredHideClassB(!hideClassB);
  }, [hideClassB]);

  const [showAircraft, setShowAircraft] = useState(getStoredShowAircraft);

  const toggleAircraft = useCallback(() => {
    setShowAircraft(!showAircraft);
    setStoredShowAircraft(!showAircraft);
  }, [showAircraft]);

  const toggleAircraftPopup = useCallback((hex: string) => {
    setOpenPopupId((open) => (open === `aircraft:${hex}` ? null : `aircraft:${hex}`));
  }, []);

  // Ships drawn on the map; Class B craft can be hidden
  const mapShips = useMemo(
    () =>
      hideClassB
        ? new globalThis.Map(Array.from(ships).filter(([, ship]) => !ship.classB))
        : ships,
    [ships, hideClassB]
  );

  // Reset error count when theme changes (React recommended pattern for adjusting state on prop change)
  const [prevTheme, setPrevTheme] = useState(theme);
  if (prevTheme !== theme) {
    setPrevTheme(theme);
    setErrorCount(0);
  }

  // Derive map style from theme + error count
  const mapStyle = useMemo(() => {
    const provider = TILE_PROVIDERS[theme];
    return errorCount >= 3 ? provider.fallback.style : provider.primary.style;
  }, [theme, errorCount]);

  const handleMapError = useCallback((e: MapErrorEvent) => {
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
        }
        return newCount;
      });
    }
  }, [theme]);

  const handleStyleLoad = useCallback(() => {
    setErrorCount(0);
  }, []);

  // Map events for the interactive hull layers only
  const [hoveringHull, setHoveringHull] = useState(false);
  const handleHullEnter = useCallback(() => setHoveringHull(true), []);
  const handleHullLeave = useCallback(() => setHoveringHull(false), []);

  // Hulls are map features rather than markers, so clicks on them arrive here
  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const mmsi = e.features?.[0]?.properties?.mmsi as number | undefined;
    const ship = mmsi !== undefined ? ships.get(mmsi) : undefined;
    if (!ship) {
      setOpenPopupId(null);
      return;
    }
    setOpenPopupId((open) => (open === ship.mmsi ? null : ship.mmsi));
    onSelectShip?.(ship);
  }, [ships, onSelectShip]);

  const handleMove = useCallback((e: { viewState: { pitch: number; bearing: number; zoom: number } }) => {
    setBearing(e.viewState.bearing);
    setZoom(e.viewState.zoom);
  }, []);

  const handleMoveEnd = useCallback((e: { viewState: { pitch: number; bearing: number } }) => {
    setIs3D(e.viewState.pitch > 0);
    setBearing(e.viewState.bearing);
  }, []);

  // Open popup when ship is selected from list (React recommended pattern for adjusting state on prop change)
  const [prevSelectedMmsi, setPrevSelectedMmsi] = useState<number | undefined>(selectedShip?.mmsi);
  if (selectedShip && selectedShip.mmsi !== prevSelectedMmsi) {
    setPrevSelectedMmsi(selectedShip.mmsi);
    setOpenPopupId(selectedShip.mmsi);
  }

  return (
    <div className={`w-full h-full ${showShipList ? "ship-list-visible" : ""}`}>
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
        interactiveLayerIds={HULL_INTERACTIVE_LAYERS}
        onMouseEnter={handleHullEnter}
        onMouseLeave={handleHullLeave}
        cursor={hoveringHull ? "pointer" : undefined}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <ShipHulls ships={mapShips} zoom={zoom} selectedMmsi={selectedShip?.mmsi} />
        <BridgeMarker
          isPopupOpen={openPopupId === "bridge"}
          onTogglePopup={() =>
            setOpenPopupId(openPopupId === "bridge" ? null : "bridge")
          }
          onSelect={() => onSelectShip?.(null)}
        />
        {showAircraft &&
          aircraft.map((plane) => (
            <AircraftMarker
              key={plane.hex}
              aircraft={plane}
              isPopupOpen={openPopupId === `aircraft:${plane.hex}`}
              onTogglePopup={toggleAircraftPopup}
              is3D={is3D}
            />
          ))}
        {Array.from(mapShips.values()).map((ship) => (
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
            showArrow={!showsHull(ship, zoom)}
          />
        ))}
        <MapController
          selectedShip={selectedShip}
          ships={ships}
          isBridgeSelected={openPopupId === "bridge"}
          showShipList={showShipList}
          shipCamSize={shipCamSize}
        />
        <MapControlGroup theme={theme} is3D={is3D} onToggle3D={setIs3D} bearing={bearing} showShipList={showShipList} onToggleShipList={onToggleShipList} shipCamSize={shipCamSize} hideClassB={hideClassB} onToggleClassB={toggleClassB} showAircraft={showAircraft} onToggleAircraft={toggleAircraft} />
      </Map>
      <AttributionToggle theme={theme} showShipList={showShipList} />
    </div>
  );
}
