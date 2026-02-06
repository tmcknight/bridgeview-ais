import { useCallback, useEffect, useState } from "react";
import ShipMap from "./components/ShipMap";
import ShipList from "./components/ShipList";
import NotificationPanel from "./components/NotificationPanel";
import StatusBar from "./components/StatusBar";
import ApiKeyPrompt from "./components/ApiKeyPrompt";
import { useAISStream } from "./hooks/useAISStream";
import "leaflet/dist/leaflet.css";
import "./App.css";

const STORAGE_KEY = "bridgeview-ais-apikey";

function App() {
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  });

  const {
    ships,
    notifications,
    connectionStatus,
    dismissNotification,
    clearNotifications,
  } = useAISStream(apiKey);

  useEffect(() => {
    if (globalThis.Notification && globalThis.Notification.permission === "default") {
      globalThis.Notification.requestPermission();
    }
  }, []);

  const handleApiKey = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey("");
  }, []);

  if (!apiKey) {
    return <ApiKeyPrompt onSubmit={handleApiKey} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>BridgeView AIS</h1>
          <span className="subtitle">Blue Water Bridge Ship Tracker</span>
        </div>
        <div className="header-right">
          <button className="logout-btn" onClick={handleLogout} title="Change API key">
            Change API Key
          </button>
        </div>
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
