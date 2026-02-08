import { useCallback, useState } from "react";
import { Button } from "@headlessui/react";
import { SunIcon, MoonIcon } from "@heroicons/react/24/outline";
import ShipMap from "./components/ShipMap";
import ShipList from "./components/ShipList";
import NotificationPanel from "./components/NotificationPanel";
import StatusBar from "./components/StatusBar";
import ComponentErrorBoundary from "./components/ComponentErrorBoundary";
import { useAISStream } from "./hooks/useAISStream";
import { useTheme } from "./hooks/useTheme";
import type { TrackedShip } from "./types/ais";

function App() {
  const {
    ships,
    notifications,
    connectionStatus,
    dismissNotification,
    clearNotifications,
  } = useAISStream();

  const { theme, toggleTheme } = useTheme();
  const [selectedShip, setSelectedShip] = useState<TrackedShip | null>(null);

  const [notifPermission, setNotifPermission] = useState(() => {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  const requestNotifications = useCallback(() => {
    globalThis.Notification?.requestPermission().then((perm) => {
      setNotifPermission(perm);
    });
  }, []);

  const handleSelectShip = useCallback((ship: TrackedShip) => {
    setSelectedShip(ship);
  }, []);

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${theme === 'dark' ? 'dark' : ''}`}>
      <header className="flex items-center justify-between px-5 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-600 shrink-0">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">BridgeView AIS</h1>
          <span className="text-xs text-slate-600 dark:text-slate-400">Blue Water Bridge Ship Tracker</span>
        </div>
        <div className="flex items-center gap-4">
          {notifPermission === "default" && (
            <Button
              className="bg-transparent border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-md text-xs transition-all hover:border-blue-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              onClick={requestNotifications}
            >
              Enable Notifications
            </Button>
          )}
          <Button
            className="p-2 rounded-md transition-colors bg-transparent hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <SunIcon className="w-5 h-5 text-slate-400 dark:text-slate-400" />
            ) : (
              <MoonIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            )}
          </Button>
          <StatusBar connectionStatus={connectionStatus} />
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden max-md:flex-col">
        <div className="flex-1 relative min-w-0 max-md:h-[50vh]">
          <ComponentErrorBoundary componentName="Map">
            <ShipMap ships={ships} selectedShip={selectedShip} onSelectShip={handleSelectShip} theme={theme} />
          </ComponentErrorBoundary>
          <NotificationPanel
            notifications={notifications}
            onDismiss={dismissNotification}
            onClear={clearNotifications}
          />
          {connectionStatus === 'connecting' && ships.size === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-50">
              <div className="flex flex-col items-center gap-3 px-6 py-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-300 dark:border-slate-600 shadow-xl">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <p className="text-slate-800 dark:text-slate-200 font-medium">Connecting to AIS stream...</p>
              </div>
            </div>
          )}
        </div>
        <aside className="w-95 shrink-0 overflow-y-auto bg-slate-200 dark:bg-slate-800 border-l border-slate-300 dark:border-slate-600 max-md:w-full max-md:border-l-0 max-md:border-t max-md:border-slate-300 dark:max-md:border-slate-600 max-md:h-[50vh]">
          <ComponentErrorBoundary componentName="Ship List">
            <ShipList ships={ships} selectedShip={selectedShip} onSelectShip={handleSelectShip} />
          </ComponentErrorBoundary>
        </aside>
      </main>
    </div>
  );
}

export default App;
