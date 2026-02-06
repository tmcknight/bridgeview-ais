import { useCallback, useState } from "react";
import ShipMap from "./components/ShipMap";
import ShipList from "./components/ShipList";
import NotificationPanel from "./components/NotificationPanel";
import StatusBar from "./components/StatusBar";
import { useAISStream } from "./hooks/useAISStream";
import "leaflet/dist/leaflet.css";
import "./App.css";

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
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>BridgeView AIS</h1>
          <span className="subtitle">Blue Water Bridge Ship Tracker</span>
        </div>
        {notifPermission === "default" && (
          <div className="header-right">
            <button className="notify-btn" onClick={requestNotifications}>
              Enable Notifications
            </button>
          </div>
        )}
      </header>

      <StatusBar connectionStatus={connectionStatus} shipCount={ships.size} />

      <main className="app-main">
        <div className="map-section">
          <ShipMap ships={ships} />
          <NotificationPanel
            notifications={notifications}
            onDismiss={dismissNotification}
            onClear={clearNotifications}
          />
        </div>
        <aside className="sidebar">
          <ShipList ships={ships} />
        </aside>
      </main>
    </div>
  );
}

export default App;
