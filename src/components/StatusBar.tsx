import type { ConnectionStatus } from "../hooks/useAISStream";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; pingClass: string; staticClass: string; showPing: boolean }
> = {
  connected: {
    label: "Connected",
    pingClass: "bg-green-400",
    staticClass: "bg-green-500 shadow-[0_0_6px_theme(--color-green-500)]",
    showPing: true,
  },
  connecting: {
    label: "Connecting...",
    pingClass: "bg-amber-400",
    staticClass: "bg-amber-500",
    showPing: false,
  },
  disconnected: {
    label: "Disconnected",
    pingClass: "",
    staticClass: "bg-slate-400",
    showPing: false,
  },
  error: {
    label: "Connection Error",
    pingClass: "",
    staticClass: "bg-red-500",
    showPing: false,
  },
};

export default function StatusBar({ connectionStatus }: StatusBarProps) {
  const config = STATUS_CONFIG[connectionStatus];

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <span className="text-slate-600 dark:text-slate-400">
        AIS Data via <a href="https://aisstream.io" target="_blank" rel="noopener noreferrer" className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 underline">aisstream.io</a>
      </span>
      <div className="flex items-center gap-1.5" aria-live="polite" aria-atomic="true">
        <span className="relative flex size-2" aria-hidden="true">
          {config.showPing && (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${config.pingClass} opacity-75`} />
          )}
          <span className={`relative inline-flex size-2 rounded-full ${config.staticClass}`} />
        </span>
        <span className="text-slate-800 dark:text-slate-200">{config.label}</span>
      </div>
    </div>
  );
}
