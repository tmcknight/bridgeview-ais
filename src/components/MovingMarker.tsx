import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import { useMap } from "react-map-gl/maplibre";
import { motionAt, motionSettled, startMotion, type Motion, type MotionFix } from "../utils/motion";

// One animation frame loop shared by every moving marker
const frameListeners = new Set<(now: number) => void>();
let frame = 0;

function onFrame(listener: (now: number) => void): () => void {
  frameListeners.add(listener);
  if (!frame) {
    frame = requestAnimationFrame(function step(now) {
      for (const l of frameListeners) l(now);
      frame = frameListeners.size ? requestAnimationFrame(step) : 0;
    });
  }
  return () => {
    frameListeners.delete(listener);
  };
}

// Smallest move or turn a marker is redrawn for while gliding. MapLibre
// rounds a marker set this way to whole pixels, so smaller steps barely show
const MIN_MOVE_PX = 0.5;
const MIN_TURN_DEG = 0.25;
// Metres per pixel at zoom 0 on the equator (MapLibre's 512px tiles)
const EQUATOR_M_PER_PX = 40_075_016.686 / 512;
const M_PER_DEG = 111_320;

/** Roughly how far apart two positions are on screen at this zoom, in pixels */
function movedPx(lat: number, lon: number, to: { lat: number; lon: number }, zoom: number): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metres = Math.hypot((to.lat - lat) * M_PER_DEG, (to.lon - lon) * M_PER_DEG * cosLat);
  return metres / ((EQUATOR_M_PER_PX * cosLat) / 2 ** zoom);
}

/**
 * A map marker that glides between position reports instead of jumping.
 * Unlike react-map-gl's Marker, its position is set every frame rather than from props.
 */
export default function MovingMarker({
  fix,
  maxAgeMs,
  onClick,
  className,
  pitchAlignment,
  popup,
  children,
}: {
  fix: MotionFix;
  maxAgeMs: number;
  onClick: (e: MouseEvent) => void;
  className?: string;
  pitchAlignment: "map" | "viewport";
  /** Shown above the marker while set */
  popup?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { current: map } = useMap();
  const [marker] = useState(() =>
    new maplibregl.Marker({
      element: document.createElement("div"),
      anchor: "center",
      rotationAlignment: "map",
      rotation: fix.rotation,
    }).setLngLat([fix.lon, fix.lat])
  );
  // Made together: a second Popup given the same content (as StrictMode's double call would) takes it from the first
  const [{ popupInstance, popupContent }] = useState(() => {
    const content = document.createElement("div");
    return {
      popupContent: content,
      popupInstance: new maplibregl.Popup({ anchor: "bottom", offset: 12, closeButton: false, closeOnClick: false })
        .setDOMContent(content),
    };
  });
  const motionRef = useRef<Motion | undefined>(undefined);

  useEffect(() => {
    if (!map) return;
    marker.addTo(map.getMap());
    return () => {
      marker.remove();
    };
  }, [map, marker]);

  const { lat, lon, speed, course, rotation, reportedAt } = fix;
  // Before paint, so a new report never shows for a frame at its raw position.
  // The marker is moved each frame until it settles, then leaves the frame
  // loop (which stops once no marker is moving) until its next report
  useLayoutEffect(() => {
    const motion = startMotion(
      motionRef.current,
      { lat, lon, speed, course, rotation, reportedAt },
      performance.now(),
      maxAgeMs
    );
    motionRef.current = motion;
    const stop = onFrame((now) => {
      const position = motionAt(motion, now);
      const settled = motionSettled(motion, now);
      // Each move costs MapLibre a transform and a frame of its own, so
      // movements too small to see are skipped (a ship at 10 kn crosses a
      // fraction of a pixel a second when zoomed out); the final one isn't
      const current = marker.getLngLat();
      const zoom = map?.getZoom();
      const moved = current.lat !== position.lat || current.lng !== position.lon;
      if (moved && (settled || zoom === undefined || movedPx(current.lat, current.lng, position, zoom) >= MIN_MOVE_PX)) {
        marker.setLngLat([position.lon, position.lat]);
        if (popupInstance.isOpen()) popupInstance.setLngLat([position.lon, position.lat]);
      }
      const turn = Math.abs(((marker.getRotation() - position.rotation + 540) % 360) - 180);
      if (turn > 0 && (settled || turn >= MIN_TURN_DEG)) marker.setRotation(position.rotation);
      if (settled) stop();
    });
    return stop;
  }, [lat, lon, speed, course, rotation, reportedAt, maxAgeMs, map, marker, popupInstance]);

  useEffect(() => {
    const element = marker.getElement();
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  }, [marker, onClick]);

  useEffect(() => {
    if (!className) return;
    marker.addClassName(className);
    return () => {
      marker.removeClassName(className);
    };
  }, [marker, className]);

  useEffect(() => {
    marker.setPitchAlignment(pitchAlignment);
  }, [marker, pitchAlignment]);

  const popupOpen = popup !== undefined && popup !== null && popup !== false;
  useEffect(() => {
    if (!map || !popupOpen) return;
    popupInstance.setLngLat(marker.getLngLat()).addTo(map.getMap());
    return () => {
      popupInstance.remove();
    };
  }, [map, marker, popupInstance, popupOpen]);

  return (
    <>
      {createPortal(children, marker.getElement())}
      {popupOpen && createPortal(popup, popupContent)}
    </>
  );
}
