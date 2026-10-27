import type { ConnectionStatus } from "../hooks/useAISStream";
import type { AISSource } from "../types/ais";
import type { FeedHealth, FeedStatus } from "../utils/feedStatus";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  /** Health of each AIS feed, as reported by the server; null while unknown */
  feeds?: FeedStatus[] | null;
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

const FEED_CONFIG: Record<
  FeedHealth,
  { label: string; pingClass: string; staticClass: string; showPing: boolean }
> = {
  live: {
    label: "live",
    pingClass: "bg-green-400",
    staticClass: "bg-green-500 shadow-[0_0_6px_theme(--color-green-500)]",
    showPing: true,
  },
  quiet: {
    label: "connected, but no messages lately",
    pingClass: "",
    staticClass: "bg-amber-500",
    showPing: false,
  },
  connecting: {
    label: "connecting",
    pingClass: "",
    staticClass: "bg-slate-400",
    showPing: false,
  },
  down: {
    label: "down",
    pingClass: "",
    staticClass: "bg-red-500",
    showPing: false,
  },
};

const FEED_NAMES: Record<AISSource, string> = {
  aisstream: "AISStream.io",
  local: "Local antenna",
};

function feedTitle(feed: FeedStatus): string {
  let title = `${FEED_NAMES[feed.source]}: ${FEED_CONFIG[feed.status].label}`;
  if (feed.detail) title += ` (${feed.detail})`;
  if (feed.status !== "live" && feed.lastMessageAt) {
    title += `. Last message ${new Date(feed.lastMessageAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return title;
}

const AISSTREAM_LINK = (
  <a
    href="https://aisstream.io"
    target="_blank"
    rel="noopener noreferrer"
    className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 underline"
  >
    aisstream.io
  </a>
);

function Feed({ feed }: { feed: FeedStatus }) {
  const config = FEED_CONFIG[feed.status];
  const title = feedTitle(feed);
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <StatusDot pingClass={config.pingClass} staticClass={config.staticClass} showPing={config.showPing} />
      {feed.source === "aisstream" ? AISSTREAM_LINK : <span>local antenna</span>}
      <span className="sr-only">{title}</span>
    </span>
  );
}

interface StatusDotProps {
  pingClass: string;
  staticClass: string;
  showPing: boolean;
}

function StatusDot({ pingClass, staticClass, showPing }: StatusDotProps) {
  return (
    <span className="relative flex size-2" aria-hidden="true">
      {showPing && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pingClass} opacity-75`} />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${staticClass}`} />
    </span>
  );
}

export default function StatusBar({ connectionStatus, feeds }: StatusBarProps) {
  const config = STATUS_CONFIG[connectionStatus];

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      {feeds && feeds.length > 0 ? (
        <span className="flex flex-wrap items-center justify-end gap-x-2 text-slate-600 dark:text-slate-400" aria-live="polite">
          AIS Data via
          {feeds.map((feed) => (
            <Feed key={feed.source} feed={feed} />
          ))}
        </span>
      ) : (
        <span className="text-slate-600 dark:text-slate-400">AIS Data via {AISSTREAM_LINK}</span>
      )}
      <div className="flex items-center gap-1.5" aria-live="polite" aria-atomic="true">
        <StatusDot pingClass={config.pingClass} staticClass={config.staticClass} showPing={config.showPing} />
        <span className="text-slate-800 dark:text-slate-200">{config.label}</span>
      </div>
    </div>
  );
}
