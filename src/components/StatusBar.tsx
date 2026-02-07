import type { ConnectionStatus } from "../hooks/useAISStream";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  shipCount: number;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; dotClass: string }
> = {
  connected: {
    label: "Connected",
    dotClass: "bg-green-500 shadow-[0_0_6px_theme(--color-green-500)]",
  },
  connecting: {
    label: "Connecting...",
    dotClass: "bg-amber-500 animate-pulse",
  },
  disconnected: {
    label: "Disconnected",
    dotClass: "bg-slate-400",
  },
  error: {
    label: "Connection Error",
    dotClass: "bg-red-500",
  },
};

export default function StatusBar({ connectionStatus, shipCount }: StatusBarProps) {
  const config = STATUS_CONFIG[connectionStatus];

  return (
    <div className="flex items-center justify-between px-5 py-1.5 bg-slate-700 border-b border-slate-600 text-xs shrink-0">
      <div className="flex items-center gap-4" aria-live="polite" aria-atomic="true">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${config.dotClass}`} aria-hidden="true" />
          <span>{config.label}</span>
        </div>
        <span className="text-slate-400">{shipCount} vessel{shipCount !== 1 ? "s" : ""} tracked</span>
      </div>
      <div>
        <span className="text-slate-400">AIS Data via aisstream.io</span>
      </div>
    </div>
  );
}
