import { useCallback, useState } from "react";
import { Button } from "@headlessui/react";
import ShipMap from "./components/ShipMap";
import ShipList from "./components/ShipList";
import NotificationPanel from "./components/NotificationPanel";
import StatusBar from "./components/StatusBar";
import ComponentErrorBoundary from "./components/ComponentErrorBoundary";
import { useAISStream } from "./hooks/useAISStream";
import "leaflet/dist/leaflet.css";

function App() {
  const {
    ships,
    notifications,
    connectionStatus,
    dismissNotification,
    clearNotifications,
  } = useAISStream();

  const [notifPermission, setNotifPermission] = useState(
    () => globalThis.Notification?.permission ?? "denied"
  );

  const requestNotifications = useCallback(() => {
    globalThis.Notification?.requestPermission().then((perm) => {
      setNotifPermission(perm);
    });
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 bg-slate-800 border-b border-slate-600 shrink-0">
        <div className="flex items-baseline gap-3 max-md:flex-col max-md:gap-0">
          <h1 className="text-xl font-bold text-slate-200">BridgeView AIS</h1>
          <span className="text-xs text-slate-400">Blue Water Bridge Ship Tracker</span>
        </div>
        {notifPermission === "default" && (
          <div>
            <Button
              className="bg-transparent border border-slate-600 text-slate-400 px-3 py-1.5 rounded-md text-xs transition-all hover:border-blue-500 hover:text-slate-200 cursor-pointer"
              onClick={requestNotifications}
            >
              Enable Notifications
            </Button>
          </div>
        )}
      </header>

      <StatusBar connectionStatus={connectionStatus} shipCount={ships.size} />

      <main className="flex flex-1 overflow-hidden max-md:flex-col">
        <div className="flex-1 relative min-w-0 max-md:h-[50vh]">
          <ComponentErrorBoundary componentName="Map">
            <ShipMap ships={ships} />
          </ComponentErrorBoundary>
          <NotificationPanel
            notifications={notifications}
            onDismiss={dismissNotification}
            onClear={clearNotifications}
          />
        </div>
        <aside className="w-95 shrink-0 overflow-y-auto bg-slate-800 border-l border-slate-600 max-md:w-full max-md:border-l-0 max-md:border-t max-md:border-slate-600 max-md:h-[50vh]">
          <ComponentErrorBoundary componentName="Ship List">
            <ShipList ships={ships} />
          </ComponentErrorBoundary>
        </aside>
      </main>
    </div>
  );
}

export default App;
