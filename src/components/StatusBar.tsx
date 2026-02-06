import type { ConnectionStatus } from "../hooks/useAISStream";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  shipCount: number;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; className: string }
> = {
  connected: { label: "Connected", className: "status-connected" },
  connecting: { label: "Connecting...", className: "status-connecting" },
  disconnected: { label: "Disconnected", className: "status-disconnected" },
  error: { label: "Connection Error", className: "status-error" },
};

export default function StatusBar({ connectionStatus, shipCount }: StatusBarProps) {
  const config = STATUS_CONFIG[connectionStatus];

  return (
    <div className="status-bar">
      <div className="status-left">
        <div className={`status-indicator ${config.className}`}>
          <span className="status-dot" />
          <span>{config.label}</span>
        </div>
        <span className="ship-count">{shipCount} vessel{shipCount !== 1 ? "s" : ""} tracked</span>
      </div>
      <div className="status-right">
        <span className="data-source">AIS Data via aisstream.io</span>
      </div>
    </div>
  );
}
