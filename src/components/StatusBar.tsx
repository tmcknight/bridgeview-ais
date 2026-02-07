import type { ConnectionStatus } from "../hooks/useAISStream";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; dotClass: string }
> = {
  connected: {
    label: "Connected",
    dotClass: "bg-green-500 shadow-[0_0_6px_theme(--color-green-500)] animate-pulse",
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

export default function StatusBar({ connectionStatus }: StatusBarProps) {
  const config = STATUS_CONFIG[connectionStatus];

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <span className="text-slate-400">
        AIS Data via <a href="https://aisstream.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">aisstream.io</a>
      </span>
      <div className="flex items-center gap-1.5" aria-live="polite" aria-atomic="true">
        <span className={`inline-block w-2 h-2 rounded-full ${config.dotClass}`} aria-hidden="true" />
        <span className="text-slate-200">{config.label}</span>
      </div>
    </div>
  );
}
