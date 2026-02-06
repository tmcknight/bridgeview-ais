import { Transition } from "@headlessui/react";
import { Button } from "@headlessui/react";
import type { Notification } from "../hooks/useAISStream";

interface NotificationPanelProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onClear: () => void;
}

const TYPE_STYLES: Record<string, string> = {
  approaching: "bg-red-500/10 border-l-3 border-l-red-500",
  passing: "bg-amber-500/10 border-l-3 border-l-amber-500",
  info: "bg-blue-500/10 border-l-3 border-l-blue-500",
};

export default function NotificationPanel({
  notifications,
  onDismiss,
  onClear,
}: NotificationPanelProps) {
  const active = notifications.filter((n) => !n.dismissed);

  return (
    <Transition
      show={active.length > 0}
      enter="transition-opacity duration-200"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-150"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div className="absolute top-2.5 left-2.5 z-[1000] w-[340px] max-h-[400px] overflow-y-auto bg-slate-800 border border-slate-600 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.4)] max-md:w-[calc(100%-20px)]">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-600">
          <h3 className="text-sm">Notifications ({active.length})</h3>
          <Button
            className="bg-transparent border-none text-slate-400 text-xs px-1.5 py-0.5 hover:text-slate-200 cursor-pointer"
            onClick={onClear}
          >
            Clear all
          </Button>
        </div>
        <div className="p-1">
          {active.slice(0, 10).map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between px-2.5 py-2 rounded-md mb-1 ${TYPE_STYLES[n.type] ?? ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-xs">{n.shipName}</div>
                <div className="text-[0.75rem] text-slate-400 mt-0.5">{n.message}</div>
                <div className="text-[0.65rem] text-slate-400 mt-0.5">
                  {n.timestamp.toLocaleTimeString()}
                </div>
              </div>
              <Button
                className="bg-transparent border-none text-slate-400 text-lg p-0 ml-2 leading-none shrink-0 hover:text-slate-200 cursor-pointer"
                onClick={() => onDismiss(n.id)}
                title="Dismiss"
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Transition>
  );
}
