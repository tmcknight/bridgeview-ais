import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ArrowTopRightOnSquareIcon, ChevronDownIcon } from "@heroicons/react/20/solid";
import type { ConnectionStatus } from "../hooks/useAISStream";
import type { FeedHealth, FeedSource, FeedStatus } from "../utils/feedStatus";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  /** Health of each AIS and ADS-B feed, as reported by the server; null while unknown */
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

const LINK_CLASS =
  "text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 underline";

const AISSTREAM_LINK = (
  <a href="https://aisstream.io" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
    aisstream.io
  </a>
);

function FeedDot({ feed }: { feed: FeedStatus }) {
  const config = FEED_CONFIG[feed.status];
  return <StatusDot pingClass={config.pingClass} staticClass={config.staticClass} showPing={config.showPing} />;
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

function FeedsMenu({ feeds }: { feeds: FeedStatus[] }) {
  const summary = feedSummary(feeds);
  return (
    <Popover className="relative">
      <PopoverButton
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none data-focus:ring-2 data-focus:ring-blue-500"
        title={summary}
      >
        <span className="flex items-center gap-1" aria-hidden="true">
          {feeds.map((feed) => (
            <FeedDot key={feed.source} feed={feed} />
          ))}
        </span>
        Sources
        <ChevronDownIcon className="size-3" aria-hidden="true" />
      </PopoverButton>
      <span className="sr-only" aria-live="polite">
        {summary}
      </span>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 4 }}
        className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs shadow-lg"
      >
        <h2 className="border-b border-slate-200 dark:border-slate-700 px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">
          Data sources
        </h2>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {feeds.map((feed) => (
            <FeedRow key={feed.source} feed={feed} />
          ))}
        </ul>
      </PopoverPanel>
    </Popover>
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
        <FeedsMenu feeds={feeds} />
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
