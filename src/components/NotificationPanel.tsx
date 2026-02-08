import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@headlessui/react";
import type { Notification } from "../hooks/useAISStream";

const AUTO_DISMISS_MS = 6000;

interface NotificationPanelProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onClear: () => void;
  onSelectShip?: (mmsi: number) => void;
}

const TYPE_ACCENT: Record<string, string> = {
  approaching: "border-l-red-500",
  passing: "border-l-amber-500",
  info: "border-l-blue-500",
};

function Toast({
  notification,
  onDismiss,
  onSelectShip,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
  onSelectShip?: (mmsi: number) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const hoveredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const startDismissTimer = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (!hoveredRef.current) {
        setExiting(true);
        setTimeout(() => onDismiss(notification.id), 300);
      }
    }, AUTO_DISMISS_MS);
  }, [notification.id, onDismiss]);

  useEffect(() => {
    // Fade in on mount
    requestAnimationFrame(() => setVisible(true));
    startDismissTimer();
    return () => clearTimeout(timerRef.current);
  }, [startDismissTimer]);

  const handleMouseEnter = () => {
    hoveredRef.current = true;
    clearTimeout(timerRef.current);
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    startDismissTimer();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExiting(true);
    setTimeout(() => onDismiss(notification.id), 300);
  };

  const n = notification;

  return (
    <div
      className={`flex items-start gap-2 w-80 max-md:w-[calc(100vw-20px)] px-3 py-2.5 rounded-lg border-l-3 bg-white dark:bg-slate-800 shadow-lg dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] cursor-pointer transition-all duration-300 ${TYPE_ACCENT[n.type] ?? ""} ${visible && !exiting ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"}`}
      onClick={() => onSelectShip?.(n.mmsi)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-xs text-slate-800 dark:text-slate-100">
          {n.shipName}
        </div>
        <div className="text-[0.75rem] text-slate-600 dark:text-slate-400 mt-0.5">
          {n.message}
        </div>
        <div className="text-[0.65rem] text-slate-500 dark:text-slate-400 mt-0.5">
          {n.timestamp.toLocaleTimeString()}
        </div>
      </div>
      <Button
        className="bg-transparent border-none text-slate-400 dark:text-slate-500 text-lg p-0 leading-none shrink-0 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
        onClick={handleDismiss}
        title="Dismiss"
      >
        ×
      </Button>
    </div>
  );
}

export default function NotificationPanel({
  notifications,
  onDismiss,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onClear: _onClear,
  onSelectShip,
}: NotificationPanelProps) {
  const active = notifications.filter((n) => !n.dismissed);

  if (active.length === 0) return null;

  return (
    <div className="absolute top-2.5 left-2.5 z-50 flex flex-col gap-2 pointer-events-none">
      {active.slice(0, 5).map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <Toast
            notification={n}
            onDismiss={onDismiss}
            onSelectShip={onSelectShip}
          />
        </div>
      ))}
    </div>
  );
}
