import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ArrowTopRightOnSquareIcon, ChevronDownIcon } from "@heroicons/react/20/solid";
import type { ConnectionStatus } from "../hooks/useAISStream";
import type { FeedHealth, FeedSource, FeedStatus } from "../utils/feedStatus";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  /** Health of each AIS and ADS-B feed, as reported by the server; null while unknown */
  feeds?: FeedStatus[] | null;
}

interface DotStyle {
  pingClass: string;
  staticClass: string;
  showPing: boolean;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  DotStyle & { label: string }
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
  DotStyle & { label: string }
> = {
  live: {
    label: "Live",
    pingClass: "bg-green-400",
    staticClass: "bg-green-500 shadow-[0_0_6px_theme(--color-green-500)]",
    showPing: true,
  },
  quiet: {
    label: "Connected, but no messages lately",
    pingClass: "",
    staticClass: "bg-amber-500",
    showPing: false,
  },
  connecting: {
    label: "Connecting",
    pingClass: "",
    staticClass: "bg-slate-400",
    showPing: false,
  },
  down: {
    label: "Down",
    pingClass: "",
    staticClass: "bg-red-500",
    showPing: false,
  },
};

const FEED_NAMES: Record<FeedSource, { name: string; carries: string }> = {
  aisstream: { name: "AISStream.io", carries: "Ships" },
  local: { name: "Local antenna", carries: "Ships" },
  aishub: { name: "AISHub", carries: "Ships" },
  adsb: { name: "ADS-B feed", carries: "Aircraft" },
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Down (reason). Last message 10:42 AM", for a feed that isn't live */
function feedStatusText(feed: FeedStatus): string {
  let text = FEED_CONFIG[feed.status].label;
  if (feed.detail) text += ` (${feed.detail})`;
  if (feed.status !== "live" && feed.lastMessageAt) text += `. Last message ${formatTime(feed.lastMessageAt)}`;
  return text;
}

const feedSummary = (feeds: FeedStatus[]): string =>
  feeds.map((feed) => `${FEED_NAMES[feed.source].name}: ${FEED_CONFIG[feed.status].label.toLowerCase()}`).join(", ");

const countSources = (count: number, state: string): string =>
  `${count} ${count === 1 ? "source" : "sources"} ${state}`;

/**
 * One status for the connection and every feed: the connection's own while it isn't up,
 * then the worst feed's ("2 sources down"), or Live when everything is
 */
function overallStatus(
  connectionStatus: ConnectionStatus,
  feeds: FeedStatus[] | null | undefined
): { label: string; dot: DotStyle } {
  if (connectionStatus !== "connected" || !feeds || feeds.length === 0) {
    return { label: STATUS_CONFIG[connectionStatus].label, dot: STATUS_CONFIG[connectionStatus] };
  }
  const down = feeds.filter((feed) => feed.status === "down").length;
  if (down > 0) {
    // Every feed down is an outage; some down still leaves ships on the map
    return { label: countSources(down, "down"), dot: down === feeds.length ? FEED_CONFIG.down : FEED_CONFIG.quiet };
  }
  const quiet = feeds.filter((feed) => feed.status === "quiet").length;
  if (quiet > 0) return { label: countSources(quiet, "quiet"), dot: FEED_CONFIG.quiet };
  if (feeds.some((feed) => feed.status === "connecting")) return { label: "Connecting...", dot: FEED_CONFIG.connecting };
  return { label: "Live", dot: FEED_CONFIG.live };
}

function FeedDot({ feed }: { feed: FeedStatus }) {
  return <StatusDot {...FEED_CONFIG[feed.status]} />;
}

/** This browser's own connection to the server, first in the menu */
function ConnectionRow({ connectionStatus }: { connectionStatus: ConnectionStatus }) {
  const config = STATUS_CONFIG[connectionStatus];
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <span className="mt-1">
        <StatusDot {...config} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-slate-800 dark:text-slate-200">BridgeView server</span>
        <p className="mt-0.5 text-slate-600 dark:text-slate-400">{config.label}</p>
      </div>
    </li>
  );
}

function FeedRow({ feed }: { feed: FeedStatus }) {
  const { name, carries } = FEED_NAMES[feed.source];
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <span className="mt-1">
        <FeedDot feed={feed} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          {feed.url ? (
            <a
              href={feed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {name}
              <ArrowTopRightOnSquareIcon className="size-3" aria-hidden="true" />
            </a>
          ) : (
            <span className="font-medium text-slate-800 dark:text-slate-200">{name}</span>
          )}
          <span className="shrink-0 text-slate-500 dark:text-slate-400">{carries}</span>
        </div>
        <p className="mt-0.5 break-words text-slate-600 dark:text-slate-400">{feedStatusText(feed)}</p>
      </div>
    </li>
  );
}

function StatusDot({ pingClass, staticClass, showPing }: DotStyle) {
  return (
    <span className="relative flex size-2" aria-hidden="true">
      {showPing && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pingClass} opacity-75`} />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${staticClass}`} />
    </span>
  );
}

// One dot and label summing up the connection and every feed, opening to each one's status
export default function StatusBar({ connectionStatus, feeds }: StatusBarProps) {
  const { label, dot } = overallStatus(connectionStatus, feeds);
  const shownFeeds = feeds ?? [];
  const title = [`${STATUS_CONFIG[connectionStatus].label}`, shownFeeds.length > 0 && feedSummary(shownFeeds)]
    .filter(Boolean)
    .join(". ");

  return (
    <Popover className="relative text-xs">
      <PopoverButton
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-800 dark:text-slate-200 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none data-focus:ring-2 data-focus:ring-blue-500"
        title={title}
        aria-label={`Status: ${label}`}
      >
        <StatusDot {...dot} />
        <span aria-live="polite" aria-atomic="true">
          {label}
        </span>
        <ChevronDownIcon className="size-3 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 4 }}
        className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs shadow-lg"
      >
        <h2 className="border-b border-slate-200 dark:border-slate-700 px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">
          Status
        </h2>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          <ConnectionRow connectionStatus={connectionStatus} />
          {shownFeeds.map((feed) => (
            <FeedRow key={feed.source} feed={feed} />
          ))}
        </ul>
      </PopoverPanel>
    </Popover>
  );
}
