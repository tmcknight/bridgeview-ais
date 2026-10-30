import Map, {
  Marker,
  Popup,
  Source,
  Layer,
  NavigationControl,
  useMap,
} from "react-map-gl/maplibre";
import type { MapRef, MarkerEvent, MapLayerMouseEvent, ErrorEvent as MapErrorEvent, StyleSpecification } from "react-map-gl/maplibre";
import type { FilterSpecification, SkySpecification } from "maplibre-gl";
import type { FeatureCollection, Point, Polygon } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import React, { useEffect, useLayoutEffect, useRef, memo, useState, useCallback, useMemo } from "react";
import type { TrackedShip } from "../types/ais";
import type { Aircraft } from "../types/aircraft";
import { aircraftLabel, formatAltitude, isRotorcraft, verticalTrend } from "../utils/aircraft";
import type { Theme } from "../hooks/useTheme";
import DataCredits from "./DataCredits";
import SourceBadge from "./SourceBadge";
import MovingMarker from "./MovingMarker";
import type { ShipCamSize } from "./ShipCam";
import { hullHeights, hullOutline, hasHull, metresPerPixel, wakeOutline } from "../utils/hull";
import { shipKind, shipModel, type ModelPart } from "../utils/shipModel";
import { aircraftHeight, aircraftModel, aircraftShape, type AircraftPart } from "../utils/aircraftModel";
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
import { bearingToBridge } from "../utils/tvMode";
import { isSpeedAvailable } from "../utils/geo";
import { buildBridgeModel } from "../utils/bridgeModel";
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

const SATELLITE_KEY = "satellite";

function getStoredSatellite(): boolean {
  try {
    return localStorage.getItem(SATELLITE_KEY) === "true";
  } catch {
    // localStorage might not be available
    return false;
  }
}

function setStoredSatellite(show: boolean): void {
  try {
    localStorage.setItem(SATELLITE_KEY, String(show));
  } catch {
    // localStorage might not be available
  }
}

// Esri World Imagery: free to use with attribution
const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Our own layers, which satellite imagery stays under
const OWN_LAYERS = new Set([
  "ship-wakes",
  "ship-hulls-fill",
  "ship-hulls-outline",
  "ship-hulls-hit",
  "ship-hulls-3d",
  "ship-hulls-ripple",
  "bridge-model",
  "aircraft-shadows",
  "aircraft-models",
]);
// How long satellite imagery takes to fade in or out (ms)
const SATELLITE_FADE_MS = 2500;

// Satellite imagery over the base map's land, water and roads, and under its
// labels, or with `bare`, over the whole base map, leaving only our ships and
// bridge on top. Fades in and out with `visible`, and once faded out is
// hidden, as a see-through layer still downloads its tiles
function SatelliteImagery({ visible, bare }: { visible: boolean; bare: boolean }) {
  const { current: map } = useMap();
  // Set on the map directly rather than as props, so that showing the layer
  // and fading it in happen together, and hiding it waits for the fade
  useEffect(() => {
    const mapInstance = map?.getMap();
    if (!mapInstance?.getLayer("satellite")) return;
    if (visible) {
      mapInstance.setLayoutProperty("satellite", "visibility", "visible");
      mapInstance.setPaintProperty("satellite", "raster-opacity", 1);
      return;
    }
    mapInstance.setPaintProperty("satellite", "raster-opacity", 0);
    const hide = setTimeout(
      () => mapInstance.getLayer("satellite") && mapInstance.setLayoutProperty("satellite", "visibility", "none"),
      SATELLITE_FADE_MS
    );
    return () => clearTimeout(hide);
  }, [map, visible]);
  // Read each render; the map re-renders often enough to catch a new style.
  // Not gated on isStyleLoaded(), which is false while tiles load and would
  // drop the imagery on top of everything, 3D ships and bridge included
  const mapInstance = map?.getMap();
  const beforeId = mapInstance
    ?.getLayersOrder()
    .find((id) => (bare ? OWN_LAYERS.has(id) : mapInstance.getLayer(id)?.type === "symbol"));
  return (
    <Source id="satellite" type="raster" tiles={[SATELLITE_TILES]} tileSize={256} maxzoom={19}>
      <Layer
        id="satellite"
        type="raster"
        beforeId={beforeId}
        layout={{ visibility: "none" }}
        paint={{
          "raster-opacity": 0,
          "raster-opacity-transition": { duration: SATELLITE_FADE_MS, delay: 0 },
        }}
      />
    </Source>
  );
}

// Vertical field of view while tilted (degrees; MapLibre's default is ~37):
// wider, so the distance shrinks away toward the horizon
const FOV_3D = 60;

// A wider lens while the map is tilted
function Perspective3D() {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map) return;
    const mapInstance = map.getMap();
    const before = mapInstance.getVerticalFieldOfView();
    mapInstance.setVerticalFieldOfView(FOV_3D);
    return () => {
      mapInstance.setVerticalFieldOfView(before);
    };
  }, [map]);
  return null;
}

// The bridge in 3D, built once
let bridgeModel: ReturnType<typeof buildBridgeModel> | undefined;

function BridgeModel() {
  bridgeModel ??= buildBridgeModel();
  return (
    <Source id="bridge-model" type="geojson" data={bridgeModel}>
      <Layer
        id="bridge-model"
        type="fill-extrusion"
        paint={{
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-height": ["get", "height"],
        }}
      />
    </Source>
  );
}

// Sky and haze toward the horizon, seen when the map is tilted
const SKY: Record<Theme, SkySpecification> = {
  light: {
    "sky-color": "#7cc4f0",
    "horizon-color": "#e0f2fe",
    "fog-color": "#eef6fb",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.85,
  },
  dark: {
    "sky-color": "#0b1220",
    "horizon-color": "#1e293b",
    "fog-color": "#1e293b",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.85,
  },
};

// Lowest the camera can tilt to (degrees from looking straight down)
const MAX_PITCH = 85;
// Tilt for the 3D button
const PITCH_3D = 70;

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
interface HullMinSize {
  lengthPx: number;
  beamPx: number;
}
// Hulls never shrink below the arrow's size, so small or distant ships stay visible
const HULL_MIN_SIZE: HullMinSize = { lengthPx: 24, beamPx: 6 };
// TV mode watches one ship from afar, so keeps them close to true scale, just
// big enough not to vanish
const TV_HULL_MIN_SIZE: HullMinSize = { lengthPx: 8, beamPx: 2 };

function showsHull(ship: TrackedShip, zoom: number): boolean {
  return zoom >= HULL_MIN_ZOOM && hasHull(ship.dimensions);
}

interface HullFeatures {
  hulls: FeatureCollection<Polygon>;
  /** The selected ship's centre, with the ripple's starting radius in pixels */
  ripple: FeatureCollection<Point>;
}

// 3D model colours, apart from the hull, which keeps the ship's status colour
const MODEL_COLORS: Record<Exclude<ModelPart, "hull">, string> = {
  deck: "#57534e",
  house: "#f8fafc",
  funnel: "#1f2937",
  gear: "#d4d4d8",
};

// Hull outlines: true to scale when zoomed in, blown up to a minimum size further out.
// Each hull comes with its 3D model (what stands on deck), which only the 3D
// view draws, and its wake while it's under way
function buildHullFeatures(
  ships: Map<number, TrackedShip>,
  zoom: number,
  position: (ship: TrackedShip) => MotionPosition,
  minSize: HullMinSize,
  selectedMmsi?: number
): HullFeatures {
  const hulls: FeatureCollection<Polygon>["features"] = [];
  const ripple: FeatureCollection<Point>["features"] = [];
  for (const ship of ships.values()) {
    if (!showsHull(ship, zoom)) continue;
    const { lat, lon, rotation } = position(ship);
    const mpp = metresPerPixel(zoom, lat);
    const minLength = minSize.lengthPx * mpp;
    const minBeam = minSize.beamPx * mpp;
    const outline = hullOutline(
      lat,
      lon,
      rotation,
      ship.dimensions!,
      minLength,
      minBeam
    );
    if (!outline) continue;
    const length = ship.dimensions!.toBow + ship.dimensions!.toStern;
    const color = getShipColor(ship);
    hulls.push({
      type: "Feature",
      properties: { mmsi: ship.mmsi, color, part: "hull", base: 0, height: hullHeights(length).deck },
      geometry: { type: "Polygon", coordinates: [outline] },
    });
    const model = shipModel(
      lat,
      lon,
      rotation,
      ship.dimensions!,
      shipKind(ship.shipType, length),
      minLength,
      minBeam
    );
    // The first block is the hull itself, already added
    for (const block of model.slice(1)) {
      hulls.push({
        type: "Feature",
        properties: {
          mmsi: ship.mmsi,
          color: block.part === "hull" ? color : MODEL_COLORS[block.part],
          part: "model",
          base: block.base,
          height: block.height,
        },
        geometry: { type: "Polygon", coordinates: [block.outline] },
      });
    }
    const moving = isSpeedAvailable(ship.sog) && ship.navStatus !== 1 && ship.navStatus !== 5;
    const wake = moving
      ? wakeOutline(lat, lon, rotation, ship.dimensions!, ship.sog, minLength, minBeam)
      : [];
    for (const band of wake) {
      hulls.push({
        type: "Feature",
        properties: { mmsi: ship.mmsi, part: "wake", opacity: band.opacity },
        geometry: { type: "Polygon", coordinates: [band.outline] },
      });
    }
    if (ship.mmsi === selectedMmsi) {
      // Halfway between the middle of the stern and the bow tip
      const [sternPort, sternStarboard, , bow] = outline;
      const centre: [number, number] = [
        ((sternPort[0] + sternStarboard[0]) / 2 + bow[0]) / 2,
        ((sternPort[1] + sternStarboard[1]) / 2 + bow[1]) / 2,
      ];
      const { toBow, toStern } = ship.dimensions!;
      const lengthPx = Math.max((toBow + toStern) / mpp, minSize.lengthPx);
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
const AIRCRAFT_MODEL_LAYER = "aircraft-models";
const HULL_INTERACTIVE_LAYERS = [HULL_FILL_LAYER, HULL_HIT_LAYER, AIRCRAFT_MODEL_LAYER];
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

// Flat hulls leave the 3D models out, and nothing solid has a wake
const HULLS_ONLY: FilterSpecification = ["==", ["get", "part"], "hull"];
const WAKES_ONLY: FilterSpecification = ["==", ["get", "part"], "wake"];
const NO_WAKES: FilterSpecification = ["!=", ["get", "part"], "wake"];

function ShipHulls({
  ships,
  zoom,
  selectedMmsi,
  is3D,
  minSize,
}: {
  ships: Map<number, TrackedShip>;
  zoom: number;
  selectedMmsi?: number;
  /** Map pitched: draw the ships as solid blocks */
  is3D: boolean;
  /** The smallest a hull is drawn on screen */
  minSize: HullMinSize;
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
          minSize,
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
  }, [map, ships, zoom, selectedMmsi, minSize]);

  const selected = selectedMmsi !== undefined ? ships.get(selectedMmsi) : undefined;
  useHullRipple(selected !== undefined && showsHull(selected, zoom));
  return (
    <>
      <Source id="ship-hulls" type="geojson" data={EMPTY_FEATURES}>
        {/* Under the hulls, on the water */}
        <Layer
          id="ship-wakes"
          type="fill"
          filter={WAKES_ONLY}
          paint={{
            "fill-color": "#ffffff",
            "fill-opacity": ["get", "opacity"],
          }}
        />
        {/* Flat and solid hulls are separate layers, shown in turn: a
            layer can't change type, and swapping one for another under the
            same id breaks MapLibre's drawing */}
        <Layer
          id={HULL_FILL_LAYER}
          type="fill"
          filter={HULLS_ONLY}
          layout={{ visibility: is3D ? "none" : "visible" }}
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": 0.85,
          }}
        />
        <Layer
          id="ship-hulls-outline"
          type="line"
          filter={HULLS_ONLY}
          layout={{ visibility: is3D ? "none" : "visible" }}
          paint={{
            "line-color": "#fff",
            "line-width": 1.5,
          }}
        />
        <Layer
          id="ship-hulls-3d"
          type="fill-extrusion"
          filter={NO_WAKES}
          layout={{ visibility: is3D ? "visible" : "none" }}
          paint={{
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 0.95,
          }}
        />
        <Layer
          id={HULL_HIT_LAYER}
          type="line"
          filter={HULLS_ONLY}
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
    onSelectShip?: (ship: TrackedShip | null) => void;
    isSelected: boolean;
    is3D: boolean;
    /** False while the ship is drawn as a hull; the marker then only anchors its popup */
    showArrow: boolean;
  }) => {
    const handleClick = useCallback((e: MouseEvent) => {
      e.stopPropagation();
      onTogglePopup();
      // Clicking the open ship again closes it and lets it go
      onSelectShip?.(isPopupOpen ? null : ship);
    }, [onTogglePopup, onSelectShip, ship, isPopupOpen]);

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

// The smallest a 3D aircraft is drawn, nose to tail, on screen
const AIRCRAFT_MIN_LENGTH_PX = 28;

const AIRCRAFT_PART_COLORS: Record<Exclude<AircraftPart, "body" | "wing">, string> = {
  engine: "#475569",
  rotor: "#1f2937",
};

// Each aircraft whose height is known as a 3D model at that height, and its
// shadow on the ground below
function buildAircraftFeatures(
  aircraft: Aircraft[],
  zoom: number,
  position: (plane: Aircraft) => MotionPosition
): FeatureCollection<Polygon> {
  const features: FeatureCollection<Polygon>["features"] = [];
  for (const plane of aircraft) {
    const height = aircraftHeight(plane);
    if (height === null) continue;
    const { lat, lon, rotation } = position(plane);
    const minLength = AIRCRAFT_MIN_LENGTH_PX * metresPerPixel(zoom, lat);
    const color = getAircraftColor(plane);
    for (const block of aircraftModel(lat, lon, rotation, height, aircraftShape(plane), minLength)) {
      const blockColor = block.part === "body" || block.part === "wing" ? color : AIRCRAFT_PART_COLORS[block.part];
      features.push({
        type: "Feature",
        properties: { hex: plane.hex, part: "model", color: blockColor, base: block.base, height: block.height },
        geometry: { type: "Polygon", coordinates: [block.outline] },
      });
      // Nothing to cast while it's on the ground
      if (block.casts && height > 0) {
        features.push({
          type: "Feature",
          properties: { hex: plane.hex, part: "shadow" },
          geometry: { type: "Polygon", coordinates: [block.outline] },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

const AIRCRAFT_MODELS_ONLY: FilterSpecification = ["==", ["get", "part"], "model"];
const AIRCRAFT_SHADOWS_ONLY: FilterSpecification = ["==", ["get", "part"], "shadow"];

// Aircraft in the tilted map: 3D models flying at their altitude, moved
// between reports like the ship hulls
function AircraftModels({ aircraft, zoom }: { aircraft: Aircraft[]; zoom: number }) {
  const { current: map } = useMap();
  const motionsRef = useRef(new globalThis.Map<string, Motion>());

  // Before paint, so a new report never shows for a frame at its raw position
  useLayoutEffect(() => {
    const motions = motionsRef.current;
    const now = performance.now();
    for (const plane of aircraft) {
      const fix = aircraftFix(plane);
      const prev = motions.get(plane.hex);
      if (!prev || !sameFix(prev.fix, fix)) {
        motions.set(plane.hex, startMotion(prev, fix, now, AIRCRAFT_MAX_AGE_MS));
      }
    }
    const current = new Set(aircraft.map((plane) => plane.hex));
    for (const hex of motions.keys()) {
      if (!current.has(hex)) motions.delete(hex);
    }
  }, [aircraft]);

  // The source's data is set here every frame while aircraft are moving, not from props
  useEffect(() => {
    if (!map) return;
    const mapInstance = map.getMap();
    const motions = motionsRef.current;
    let drawn = false;
    // A new map style brings the source back empty
    const redraw = () => {
      drawn = false;
    };
    mapInstance.on("styledata", redraw);
    let frame = requestAnimationFrame(function step(now) {
      const moving = aircraft.some((plane) => {
        const motion = motions.get(plane.hex);
        return motion !== undefined && !motionSettled(motion, now);
      });
      const source = mapInstance.getSource<maplibregl.GeoJSONSource>("aircraft-models");
      if ((!drawn || moving) && source) {
        source.setData(
          buildAircraftFeatures(aircraft, zoom, (plane) => {
            const motion = motions.get(plane.hex);
            return motion ? motionAt(motion, now) : { lat: plane.lat, lon: plane.lon, rotation: plane.track ?? 0 };
          })
        );
        drawn = true;
      }
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      mapInstance.off("styledata", redraw);
    };
  }, [map, aircraft, zoom]);

  return (
    <Source id="aircraft-models" type="geojson" data={EMPTY_FEATURES}>
      <Layer
        id="aircraft-shadows"
        type="fill"
        filter={AIRCRAFT_SHADOWS_ONLY}
        paint={{
          "fill-color": "#000000",
          "fill-opacity": 0.3,
        }}
      />
      <Layer
        id={AIRCRAFT_MODEL_LAYER}
        type="fill-extrusion"
        filter={AIRCRAFT_MODELS_ONLY}
        paint={{
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-height": ["get", "height"],
        }}
      />
    </Source>
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
        {/* While it's drawn as a 3D model, the marker only anchors its popup, on the ground below */}
        {!(is3D && aircraftHeight(aircraft) !== null) && (
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
        )}
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
function AttributionToggle({ theme, showShipList, satellite }: { theme: Theme; showShipList: boolean; satellite: boolean }) {
  const [showAttribution, setShowAttribution] = useState(false);

  return (
    <div className={`absolute bottom-2.5 right-2.5 z-50 ${theme === 'dark' ? 'dark' : ''} transition-[right] duration-300 ease-in-out ${showShipList ? 'md:right-100' : ''}`}>
      {showAttribution && (
        <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1.5 px-2 py-1.5 bg-white/95 dark:bg-slate-800/95 border border-slate-300/40 dark:border-slate-600/40 rounded text-[0.65rem] text-slate-600 dark:text-slate-400 whitespace-nowrap">
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline">OpenStreetMap</a> contributors · Tiles: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer" className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline">OpenFreeMap</a>
          {satellite && " · Imagery © Esri, Maxar, Earthstar Geographics"}
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
  satellite,
  onToggleSatellite,
  onHome,
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
  satellite: boolean;
  onToggleSatellite: () => void;
  /** Lets go of the selected ship, so the map stays on the bridge */
  onHome: () => void;
}) {
  const { current: map } = useMap();

  const handleRecenter = () => {
    onHome();
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

    // The ships and the bridge rise with the tilt, and satellite imagery fades in
    map.easeTo({ pitch: next ? PITCH_3D : 0, duration: 500 });
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
          <button
            className={satellite ? MAP_BTN_3D_ACTIVE : MAP_BTN}
            onClick={onToggleSatellite}
            aria-label="Satellite view"
            aria-pressed={satellite}
            title={satellite ? "Switch to map view" : "Switch to satellite view"}
          >
            <GlobeAmericasIcon
              className={`w-3.5 h-3.5 ${satellite ? "text-white" : "text-slate-700 dark:text-white"}`}
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
  /** TV mode with the mouse still: no buttons on the map */
  hideControls?: boolean;
  /** TV mode: a ship to keep in view with the bridge, without selecting it */
  followShip?: TrackedShip | null;
  /** ...and whether to drop in behind it, looking ahead to the bridge */
  chase?: boolean;
  /** Called with the exact bearing as the map turns (every frame, so keep it cheap) */
  onBearingChange?: (bearing: number) => void;
  /** TV mode: no bridge marker, and satellite imagery fades in under the 3D
   * ships and bridge while it shows a ship */
  tvMode?: boolean;
  /** The server uses AISHub, whose terms ask for a visible credit */
  creditAishub?: boolean;
  /** The aircraft come from adsb.fi, credited while planes are shown */
  creditAdsbFi?: boolean;
}

// How long TV mode takes to glide back to the bridge
const TV_FLY_MS = 4000;
// Share of the way to its view TV mode closes each frame, so the camera
// glides rather than stepping with each position report
const TV_CAMERA_EASE = 0.03;
// Closest TV mode zooms in, however near the ship gets
const TV_MAX_ZOOM = 17;
// TV mode's two views of a ship and the bridge, both looking from the ship
// to the bridge and tilted so the 3D ships and bridge show: first from high
// up, then lower in behind the ship. Both face the same way, so going from
// one to the other is a dip and a close-in, not a spin. The two sit either
// side of a point `across` and `middle` of the way over and down the screen,
// `apart` of its height apart
interface TvView {
  pitch: number;
  /** Across the screen: right of centre, clear of the details box */
  across: number;
  middle: number;
  apart: number;
}
const TV_FRAME: TvView = { pitch: 45, across: 0.64, middle: 0.4, apart: 0.5 };
// Low in behind the ship, so the river and bridge shrink away ahead
const TV_CHASE: TvView = { pitch: 74, across: 0.62, middle: 0.5, apart: 0.34 };
// Turning is slower than the rest of the camera
const TV_TURN_EASE = 0.015;

// Each of TV mode's moves (to a new ship, or swinging round behind one)
// starts gently, building up to full speed over this long (ms)
const TV_RAMP_MS = 3000;

function tvRamp(startedAt: number, now: number): number {
  const t = Math.min(1, (now - startedAt) / TV_RAMP_MS);
  return Math.max(0.05, t * t * (3 - 2 * t));
}

// One frame of TV mode's camera: turn and tilt toward the view, and nudge the
// zoom and centre until the ship and the bridge sit where it puts them.
// Measured on screen, so it holds at any tilt or screen size
function tvStep(
  map: maplibregl.Map,
  lat: number,
  lon: number,
  chase: boolean,
  ramp: number,
  frames: number,
): maplibregl.JumpToOptions {
  const view = chase ? TV_CHASE : TV_FRAME;
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  // Eases are per 60th of a second; a late frame moves the share it missed too,
  // so a slow frame doesn't show as a stutter
  const perFrame = (rate: number): number => 1 - (1 - rate * ramp) ** frames;
  const ease = perFrame(TV_CAMERA_EASE);
  const bearing = map.getBearing();
  const turn = ((bearingToBridge(lat, lon) - bearing + 540) % 360) - 180;
  const ship = map.project([lon, lat]);
  const bridge = map.project([BRIDGE_CENTER.lng, BRIDGE_CENTER.lat]);
  const apart = Math.max(1, Math.hypot(ship.x - bridge.x, ship.y - bridge.y));
  const zoom = Math.min(TV_MAX_ZOOM, map.getZoom() + ease * Math.log2((height * view.apart) / apart));
  // Slide the map so the point between them heads for its spot
  const center = map.unproject([
    width / 2 + ((ship.x + bridge.x) / 2 - width * view.across) * ease,
    height / 2 + ((ship.y + bridge.y) / 2 - height * view.middle) * ease,
  ]);
  return {
    center,
    zoom,
    bearing: bearing + turn * perFrame(TV_TURN_EASE),
    pitch: map.getPitch() + (view.pitch - map.getPitch()) * ease,
  };
}

function MapController({
  selectedShip,
  followShip,
  chase,
  ships,
  isBridgeSelected,
  showShipList,
  shipCamSize,
}: {
  selectedShip?: TrackedShip | null;
  followShip: TrackedShip | null;
  chase: boolean;
  ships: Map<number, TrackedShip>;
  isBridgeSelected: boolean;
  showShipList: boolean;
  shipCamSize: ShipCamSize | null;
}) {
  const { current: map } = useMap();
  // A ship picked by hand wins over the one TV mode is following
  const target = selectedShip ?? followShip;
  const liveShip = target ? ships.get(target.mmsi) : null;
  const followedMmsi = liveShip?.mmsi;
  const tvFollow = !selectedShip && !!followShip;
  // Read each frame, so swinging round doesn't restart the follow; it does
  // start a new gentle move
  const chaseRef = useRef(chase);
  const moveStartRef = useRef(0);
  useLayoutEffect(() => {
    chaseRef.current = chase;
    moveStartRef.current = performance.now();
  }, [chase]);

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
    const options = {
      center: [start.lon, start.lat] as [number, number],
      essential: true,
      padding: getMapPadding(map, showShipList, shipCamSize),
    };
    const mapInstance = map.getMap();
    // TV mode's camera gets there itself, frame by frame, starting gently
    if (tvFollow) {
      moveStartRef.current = performance.now();
    } else {
      map.easeTo({ ...options, zoom: Math.max(map.getZoom(), 13), duration: 500 });
    }

    let following = true;
    const stopFollowing = () => {
      following = false;
    };
    mapInstance.on("dragstart", stopFollowing);
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      // In 60ths of a second, capped so a stall (a hidden tab) doesn't jump
      const frames = Math.min(4, Math.max(0, (now - last) / (1000 / 60)));
      last = now;
      const motion = motionRef.current?.motion;
      // Leave the camera alone while it's easing, or while someone is zooming or rotating it
      if (following && motion && !mapInstance.isMoving()) {
        const { lat, lon } = motionAt(motion, now);
        const center = mapInstance.getCenter();
        if (tvFollow) {
          const ramp = tvRamp(moveStartRef.current, now);
          mapInstance.jumpTo(tvStep(mapInstance, lat, lon, chaseRef.current, ramp, frames));
        } else if (center.lat !== lat || center.lng !== lon) {
          mapInstance.jumpTo({ center: [lon, lat] });
        }
      }
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      mapInstance.off("dragstart", stopFollowing);
    };
  }, [map, followedMmsi, tvFollow, showShipList, shipCamSize]);

  // Back to the bridge once TV mode has nothing left to follow
  const tvFollowedMmsi = followShip?.mmsi;
  const wasTvFollowing = useRef(false);
  useEffect(() => {
    if (tvFollowedMmsi !== undefined) {
      wasTvFollowing.current = true;
      return;
    }
    if (!wasTvFollowing.current || !map) return;
    wasTvFollowing.current = false;
    // Glides rather than flies, which zooms out and back in on the way
    map.easeTo({
      center: [BRIDGE_CENTER.lng, BRIDGE_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: TV_FLY_MS,
      essential: true,
      padding: getMapPadding(map, showShipList, shipCamSize),
    });
  }, [map, tvFollowedMmsi, showShipList, shipCamSize]);

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

export default function ShipMap({ ships, aircraft = [], selectedShip, onSelectShip, theme, showShipList, onToggleShipList, shipCamSize = null, hideControls = false, followShip = null, chase = false, tvMode = false, onBearingChange, creditAishub = false, creditAdsbFi = false }: ShipMapProps) {
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

  const [satellite, setSatellite] = useState(getStoredSatellite);

  const toggleSatellite = useCallback(() => {
    setSatellite(!satellite);
    setStoredSatellite(!satellite);
  }, [satellite]);

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
    const hex = e.features?.[0]?.properties?.hex as string | undefined;
    if (hex !== undefined) {
      toggleAircraftPopup(hex);
      return;
    }
    const mmsi = e.features?.[0]?.properties?.mmsi as number | undefined;
    const ship = mmsi !== undefined ? ships.get(mmsi) : undefined;
    // Empty water, or the open ship again: close it and let it go
    if (!ship || openPopupId === ship.mmsi) {
      setOpenPopupId(null);
      onSelectShip?.(null);
      return;
    }
    setOpenPopupId(ship.mmsi);
    onSelectShip?.(ship);
  }, [ships, onSelectShip, toggleAircraftPopup, openPopupId]);

  const handleHome = useCallback(() => {
    if (!selectedShip) return;
    setOpenPopupId((open) => (open === selectedShip.mmsi ? null : open));
    onSelectShip?.(null);
  }, [selectedShip, onSelectShip]);

  const handleMove = useCallback((e: { viewState: { pitch: number; bearing: number; zoom: number } }) => {
    // As soon as it tilts, so the 3D ships and bridge are there on the way
    setIs3D(e.viewState.pitch > 0);
    // Rounded: these redraw the whole map, and the camera moves every frame
    // in TV mode; unchanged values skip the redraw
    setBearing(Math.round(e.viewState.bearing));
    setZoom(Math.round(e.viewState.zoom * 4) / 4);
    onBearingChange?.(e.viewState.bearing);
  }, [onBearingChange]);

  const handleMoveEnd = useCallback((e: { viewState: { pitch: number; bearing: number } }) => {
    setIs3D(e.viewState.pitch > 0);
    setBearing(e.viewState.bearing);
  }, []);

  // Open popup when ship is selected from list (React recommended pattern for adjusting state on prop change)
  const [prevSelectedMmsi, setPrevSelectedMmsi] = useState<number | undefined>(selectedShip?.mmsi);
  if (selectedShip?.mmsi !== prevSelectedMmsi) {
    setPrevSelectedMmsi(selectedShip?.mmsi);
    if (selectedShip) setOpenPopupId(selectedShip.mmsi);
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
        maxPitch={MAX_PITCH}
        sky={SKY[theme]}
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
        {!hideControls && <NavigationControl position="top-right" showCompass={false} />}
        {/* The flat map stays a map; tilted, it's satellite imagery */}
        <SatelliteImagery visible={satellite || is3D} bare={tvMode} />
        {is3D && <BridgeModel />}
        {is3D && <Perspective3D />}
        <ShipHulls
          ships={mapShips}
          zoom={zoom}
          selectedMmsi={selectedShip?.mmsi}
          is3D={is3D}
          minSize={tvMode ? TV_HULL_MIN_SIZE : HULL_MIN_SIZE}
        />
        {is3D && showAircraft && <AircraftModels aircraft={aircraft} zoom={zoom} />}
        {!tvMode && (
          <BridgeMarker
            isPopupOpen={openPopupId === "bridge"}
            onTogglePopup={() =>
              setOpenPopupId(openPopupId === "bridge" ? null : "bridge")
            }
            onSelect={() => onSelectShip?.(null)}
          />
        )}
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
          followShip={followShip}
          chase={chase}
          ships={ships}
          isBridgeSelected={openPopupId === "bridge"}
          showShipList={showShipList}
          shipCamSize={shipCamSize}
        />
        {!hideControls && <MapControlGroup theme={theme} is3D={is3D} onToggle3D={setIs3D} bearing={bearing} showShipList={showShipList} onToggleShipList={onToggleShipList} shipCamSize={shipCamSize} hideClassB={hideClassB} onToggleClassB={toggleClassB} showAircraft={showAircraft} onToggleAircraft={toggleAircraft} satellite={satellite} onToggleSatellite={toggleSatellite} onHome={handleHome} />}
      </Map>
      {!hideControls && <AttributionToggle theme={theme} showShipList={showShipList} satellite={satellite} />}
      <DataCredits
        theme={theme}
        aishub={creditAishub}
        adsb={creditAdsbFi && showAircraft && aircraft.length > 0}
        besideButton={!hideControls}
        showShipList={showShipList}
      />
    </div>
  );
}
