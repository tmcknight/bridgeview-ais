import { useMemo } from "react";
import type { TrackedShip } from "../types/ais";
import { NAV_STATUS_LABELS } from "../types/ais";
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
} from "@heroicons/react/20/solid";
import {
  ArrowUpIcon,
  FlagIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/16/solid";

interface ShipListProps {
  ships: Map<number, TrackedShip>;
  selectedShip?: TrackedShip | null;
  onSelectShip?: (ship: TrackedShip) => void;
}

export default function ShipList({ ships, selectedShip, onSelectShip }: ShipListProps) {
  const sorted = useMemo(
    () => Array.from(ships.values()).sort(
      (a, b) => a.distanceToBridge - b.distanceToBridge
    ),
    [ships]
  );

  if (sorted.length === 0) {
    return (
      <div className="p-4">
        <h2 className="text-base mb-3 text-slate-200">Tracked Vessels</h2>
        <div className="text-center py-8 px-4 text-slate-400">
          <p className="mb-2">No vessels detected in the tracking area.</p>
          <p className="text-xs opacity-70">
            Ships will appear here as AIS data is received from the St. Clair River area.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-base mb-3 text-slate-200">Tracked Vessels ({sorted.length})</h2>
      <div className="flex flex-col gap-2">
        {sorted.map((ship) => {
          const eta = estimatedTimeToBridge(ship.distanceToBridge, ship.sog);
          const headingDeg = ship.trueHeading !== 511 ? ship.trueHeading : ship.cog;
          const isSelected = selectedShip?.mmsi === ship.mmsi;
          return (
            <div
              key={ship.mmsi}
              role="button"
              tabIndex={0}
              aria-label={`View details for ${ship.name}, ${formatDistance(ship.distanceToBridge)} from bridge`}
              aria-pressed={isSelected}
              className={`bg-slate-900 border-2 rounded-lg p-3 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isSelected
                  ? "border-blue-500 bg-blue-900/20"
                  : ship.approaching
                  ? "border-red-500"
                  : "border-slate-700 hover:border-blue-500"
              }`}
              onClick={() => onSelectShip?.(ship)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectShip?.(ship);
                }
              }}
            >
              {/* Header: name + badge */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-semibold text-sm text-slate-100 shrink-0">{ship.name}</span>
                  <span className="text-xs text-slate-400 leading-tight truncate">
                    {NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown"}
                  </span>
                </div>
                {ship.approaching && (
                  <span className="shrink-0 text-[0.6rem] font-bold text-red-400 bg-red-500/15 px-2 py-0.5 rounded tracking-wide">
                    APPROACHING
                  </span>
                )}
              </div>

              {/* Primary stats row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
                <div className="flex items-center gap-1.5 whitespace-nowrap leading-none" title="Distance to bridge">
                  <MapPinIcon className="shrink-0 w-4 h-4 text-amber-400" />
                  <span className="text-sm font-semibold text-slate-100 leading-none">{formatDistance(ship.distanceToBridge)}</span>
                </div>
                <div className="flex items-center gap-1.5 whitespace-nowrap leading-none" title="Speed over ground">
                  <BoltIcon className="shrink-0 w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold text-slate-100 leading-none">{formatSpeed(ship.sog)}</span>
                </div>
                {eta !== null && (
                  <div className="flex items-center gap-1.5 whitespace-nowrap leading-none" title="Estimated time to bridge">
                    <ClockIcon className="shrink-0 w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-slate-100 leading-none">{formatETA(eta)}</span>
                  </div>
                )}
              </div>

              {/* Secondary info */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                <div className="flex items-center gap-1 leading-tight" title="Heading">
                  <ArrowUpIcon className="shrink-0 w-3 h-3" style={{ transform: `rotate(${headingDeg}deg)` }} />
                  <span className="leading-tight">{formatHeading(headingDeg)}</span>
                </div>
                {ship.destination && (
                  <div className="flex items-center gap-1 leading-tight" title="Destination">
                    <FlagIcon className="shrink-0 w-3 h-3" />
                    <span className="leading-tight truncate max-w-32">{ship.destination}</span>
                  </div>
                )}
                {ship.length && ship.length > 0 && (
                  <div className="flex items-center gap-1 leading-tight" title="Vessel dimensions">
                    <ArrowsPointingOutIcon className="shrink-0 w-3 h-3" />
                    <span className="leading-tight">{ship.length}m × {ship.width}m</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 mt-2 pt-1.5 border-t border-slate-700/60 text-[0.65rem] text-slate-500">
                <span className="whitespace-nowrap" title="MMSI identifier">{ship.mmsi}</span>
                <span className="whitespace-nowrap" title="Last update">{new Date(ship.lastUpdate).toLocaleTimeString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
