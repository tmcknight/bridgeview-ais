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
  ArrowUpIcon,
  FlagIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/20/solid";

interface ShipListProps {
  ships: Map<number, TrackedShip>;
  selectedShip?: TrackedShip | null;
  onSelectShip?: (ship: TrackedShip) => void;
}

export default function ShipList({ ships, selectedShip, onSelectShip }: ShipListProps) {
  const sorted = Array.from(ships.values()).sort(
    (a, b) => a.distanceToBridge - b.distanceToBridge
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
              className={`bg-slate-900 border rounded-lg p-3 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isSelected
                  ? "border-blue-500 border-2 bg-blue-900/20"
                  : ship.approaching
                  ? "border-red-500 border-2"
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
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-slate-100 truncate">{ship.name}</span>
                {ship.approaching && (
                  <span className="shrink-0 text-[0.6rem] font-bold text-red-400 bg-red-500/15 px-2 py-0.5 rounded tracking-wide">
                    APPROACHING
                  </span>
                )}
              </div>

              {/* Primary stats row */}
              <div className="flex gap-4 mb-2">
                <div className="flex items-center gap-1.5 min-w-0" title="Distance to bridge">
                  <MapPinIcon className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-100">{formatDistance(ship.distanceToBridge)}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0" title="Speed over ground">
                  <BoltIcon className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-100">{formatSpeed(ship.sog)}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0" title="Estimated time to bridge">
                  <ClockIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-100">{formatETA(eta)}</span>
                </div>
              </div>

              {/* Secondary info */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <div className="flex items-center gap-1" title="Heading">
                  <ArrowUpIcon className="w-3 h-3" style={{ transform: `rotate(${headingDeg}deg)` }} />
                  <span>{formatHeading(headingDeg)}</span>
                </div>
                <span title="Navigation status">{NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown"}</span>
                {ship.destination && (
                  <div className="flex items-center gap-1" title="Destination">
                    <FlagIcon className="w-3 h-3" />
                    <span className="truncate max-w-32">{ship.destination}</span>
                  </div>
                )}
                {ship.length && ship.length > 0 && (
                  <div className="flex items-center gap-1" title="Vessel dimensions">
                    <ArrowsPointingOutIcon className="w-3 h-3" />
                    <span>{ship.length}m × {ship.width}m</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-between mt-2 pt-1.5 border-t border-slate-700/60 text-[0.65rem] text-slate-500">
                <span title="MMSI identifier">{ship.mmsi}</span>
                <span title="Last update">{new Date(ship.lastUpdate).toLocaleTimeString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
