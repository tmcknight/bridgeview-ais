import type { TrackedShip } from "../types/ais";
import { NAV_STATUS_LABELS } from "../types/ais";
import {
  formatDistance,
  formatSpeed,
  formatHeading,
  estimatedTimeToBridge,
  formatETA,
} from "../utils/geo";

interface ShipListProps {
  ships: Map<number, TrackedShip>;
  onSelectShip?: (ship: TrackedShip) => void;
}

export default function ShipList({ ships, onSelectShip }: ShipListProps) {
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
          return (
            <div
              key={ship.mmsi}
              className={`bg-slate-900 border rounded-lg p-3 cursor-pointer transition-colors ${
                ship.approaching
                  ? "border-red-500 border-2"
                  : "border-slate-600 hover:border-blue-500"
              }`}
              onClick={() => onSelectShip?.(ship)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{ship.name}</span>
                {ship.approaching && (
                  <span className="text-[0.65rem] font-bold text-red-500 bg-red-500/15 px-2 py-0.5 rounded tracking-wide">
                    APPROACHING
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex flex-col">
                  <span className="text-[0.65rem] text-slate-400 uppercase tracking-wide">Distance</span>
                  <span className="text-slate-200">{formatDistance(ship.distanceToBridge)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[0.65rem] text-slate-400 uppercase tracking-wide">Speed</span>
                  <span className="text-slate-200">{formatSpeed(ship.sog)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[0.65rem] text-slate-400 uppercase tracking-wide">Heading</span>
                  <span className="text-slate-200">{formatHeading(ship.trueHeading)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[0.65rem] text-slate-400 uppercase tracking-wide">ETA</span>
                  <span className="text-slate-200">{formatETA(eta)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[0.65rem] text-slate-400 uppercase tracking-wide">Status</span>
                  <span className="text-slate-200 text-[0.75rem]">
                    {NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown"}
                  </span>
                </div>
                {ship.destination && (
                  <div className="flex flex-col">
                    <span className="text-[0.65rem] text-slate-400 uppercase tracking-wide">Destination</span>
                    <span className="text-slate-200">{ship.destination}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-between mt-2 pt-1.5 border-t border-slate-600 text-[0.7rem] text-slate-400">
                <span>MMSI: {ship.mmsi}</span>
                <span>
                  {new Date(ship.lastUpdate).toLocaleTimeString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
