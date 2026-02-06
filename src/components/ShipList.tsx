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
      <div className="ship-list">
        <h2>Tracked Vessels</h2>
        <div className="empty-state">
          <p>No vessels detected in the tracking area.</p>
          <p className="hint">
            Ships will appear here as AIS data is received from the St. Clair River area.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ship-list">
      <h2>Tracked Vessels ({sorted.length})</h2>
      <div className="ship-cards">
        {sorted.map((ship) => {
          const eta = estimatedTimeToBridge(ship.distanceToBridge, ship.sog);
          return (
            <div
              key={ship.mmsi}
              className={`ship-card ${ship.approaching ? "approaching" : ""}`}
              onClick={() => onSelectShip?.(ship)}
            >
              <div className="ship-card-header">
                <span className="ship-name">{ship.name}</span>
                {ship.approaching && (
                  <span className="approach-tag">APPROACHING</span>
                )}
              </div>
              <div className="ship-card-details">
                <div className="detail">
                  <span className="label">Distance</span>
                  <span className="value">{formatDistance(ship.distanceToBridge)}</span>
                </div>
                <div className="detail">
                  <span className="label">Speed</span>
                  <span className="value">{formatSpeed(ship.sog)}</span>
                </div>
                <div className="detail">
                  <span className="label">Heading</span>
                  <span className="value">{formatHeading(ship.trueHeading)}</span>
                </div>
                <div className="detail">
                  <span className="label">ETA</span>
                  <span className="value">{formatETA(eta)}</span>
                </div>
                <div className="detail">
                  <span className="label">Status</span>
                  <span className="value status">
                    {NAV_STATUS_LABELS[ship.navStatus] ?? "Unknown"}
                  </span>
                </div>
                {ship.destination && (
                  <div className="detail">
                    <span className="label">Destination</span>
                    <span className="value">{ship.destination}</span>
                  </div>
                )}
              </div>
              <div className="ship-card-footer">
                <span className="mmsi">MMSI: {ship.mmsi}</span>
                <span className="updated">
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
