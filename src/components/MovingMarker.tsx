import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import { useMap } from "react-map-gl/maplibre";
import { motionAt, startMotion, type Motion, type MotionFix } from "../utils/motion";

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

  const { lat, lon, speed, course, rotation } = fix;
  // Before paint, so a new report never shows for a frame at its raw position
  useLayoutEffect(() => {
    motionRef.current = startMotion(
      motionRef.current,
      { lat, lon, speed, course, rotation },
      performance.now(),
      maxAgeMs
    );
  }, [lat, lon, speed, course, rotation, maxAgeMs]);

  useEffect(
    () =>
      onFrame((now) => {
        const motion = motionRef.current;
        if (!motion) return;
        const position = motionAt(motion, now);
        // Markers that have stopped moving are left alone
        const current = marker.getLngLat();
        if (current.lat !== position.lat || current.lng !== position.lon) {
          marker.setLngLat([position.lon, position.lat]);
          if (popupInstance.isOpen()) popupInstance.setLngLat([position.lon, position.lat]);
        }
        if (marker.getRotation() !== position.rotation) marker.setRotation(position.rotation);
      }),
    [marker, popupInstance]
  );

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
