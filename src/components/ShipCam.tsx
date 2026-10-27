import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@headlessui/react";
import {
  ArrowTopRightOnSquareIcon,
  ArrowsPointingOutIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import {
  SHIP_CAMS,
  shipCamEmbedUrl,
  shipCamWatchUrl,
} from "../constants/shipCams";

const WIDTH_KEY = "shipCamWidth";
const DEFAULT_WIDTH = 448;
const MIN_WIDTH = 240;
const KEY_STEP = 32;
// Room around the panel, and for its header row, when fitting the video into
// the map
const MARGIN = 20;
const CHROME_HEIGHT = 40;
// With a mouse, the frame and header only show while hovering (or using the
// keyboard, or resizing); touch screens can't hover, so they always show
const SHOW_ON_HOVER =
  "transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-resizing:opacity-100";

function loadWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (stored >= MIN_WIDTH) return stored;
  } catch {
    // localStorage might not be available
  }
  return DEFAULT_WIDTH;
}

// Widest the panel can get while its 16:9 video still fits on the map
function maxWidth(panel: HTMLElement | null): number {
  const area = panel?.parentElement;
  if (!area || area.clientWidth === 0) return Infinity;
  return Math.max(
    MIN_WIDTH,
    Math.min(
      area.clientWidth - MARGIN,
      ((area.clientHeight - MARGIN - CHROME_HEIGHT) * 16) / 9,
    ),
  );
}

export interface ShipCamSize {
  width: number;
  height: number;
}

interface ShipCamProps {
  onClose: () => void;
  // Called with the panel's size once it settles, and with null on close
  onResize?: (size: ShipCamSize | null) => void;
}

export default function ShipCam({ onClose, onResize }: ShipCamProps) {
  const [camId, setCamId] = useState(SHIP_CAMS[0].id);
  const cam = SHIP_CAMS.find((c) => c.id === camId) ?? SHIP_CAMS[0];
  const [width, setWidth] = useState(loadWidth);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ x: number; y: number; width: number } | null>(null);

  const resize = useCallback((next: number) => {
    setWidth(
      Math.round(
        Math.min(maxWidth(panelRef.current), Math.max(MIN_WIDTH, next)),
      ),
    );
  }, []);

  // Report the size when it settles, not on every step of a drag
  useEffect(() => {
    const panel = panelRef.current;
    if (resizing || !panel || !onResize) return;
    const report = () =>
      onResize({ width: panel.offsetWidth, height: panel.offsetHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [resizing, onResize]);

  useEffect(() => () => onResize?.(null), [onResize]);

  useEffect(() => {
    if (resizing) return;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // localStorage might not be available
    }
  }, [width, resizing]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, width };
    setResizing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = dragRef.current;
    if (!start) return;
    // The panel sits in the bottom-left corner, so it grows right and up.
    // Follow whichever way the pointer has moved further
    const fromX = e.clientX - start.x;
    const fromY = ((start.y - e.clientY) * 16) / 9;
    resize(start.width + (Math.abs(fromX) > Math.abs(fromY) ? fromX : fromY));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
    setResizing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      resize(width + KEY_STEP);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      resize(width - KEY_STEP);
    }
  };

  return (
    <section
      ref={panelRef}
      aria-label="Ship cam"
      data-resizing={resizing || undefined}
      style={{ "--cam-w": `${width}px` } as React.CSSProperties}
      className="group absolute bottom-2.5 left-2.5 z-50 w-(--cam-w) max-w-[calc(100%-20px)] max-md:w-[calc(100%-20px)] max-md:top-2.5 max-md:bottom-auto rounded-lg overflow-hidden bg-white dark:bg-slate-800 pointer-fine:bg-black"
    >
      <div
        className={`pointer-events-none absolute inset-0 z-20 rounded-lg border border-slate-300 dark:border-slate-600 ${SHOW_ON_HOVER}`}
      />
      <div
        className={`flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pointer-fine:absolute pointer-fine:inset-x-0 pointer-fine:top-0 pointer-fine:z-10 pointer-fine:bg-white/90 dark:pointer-fine:bg-slate-800/90 pointer-fine:backdrop-blur-sm ${SHOW_ON_HOVER}`}
      >
        <div className="flex flex-1 gap-1 min-w-0" role="group" aria-label="Choose a cam">
          {SHIP_CAMS.map((c) => (
            <Button
              key={c.id}
              className={`px-2 py-1 rounded text-xs truncate cursor-pointer transition-colors ${c.id === cam.id ? "bg-blue-500 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
              aria-pressed={c.id === cam.id}
              onClick={() => setCamId(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </div>
        <a
          href={shipCamWatchUrl(cam)}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          aria-label={`Open ${cam.name} on YouTube`}
          title={`Live stream from ${cam.operator}; open on YouTube`}
        >
          <ArrowTopRightOnSquareIcon className="w-4 h-4" />
        </a>
        <Button
          className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          onClick={onClose}
          aria-label="Close ship cam"
          title="Close"
        >
          <XMarkIcon className="w-4 h-4" />
        </Button>
        <button
          type="button"
          className="max-md:hidden p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-nesw-resize touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          aria-label="Resize ship cam"
          title="Drag to resize (or use arrow keys)"
        >
          <ArrowsPointingOutIcon className="w-4 h-4" />
        </button>
      </div>
      <iframe
        key={cam.id}
        className={`block w-full aspect-video bg-black ${resizing ? "pointer-events-none" : ""}`}
        src={shipCamEmbedUrl(cam)}
        title={`${cam.name} live cam`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </section>
  );
}
