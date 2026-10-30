import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@headlessui/react"
import {
  SunIcon,
  MoonIcon,
  TvIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline"
import ShipMap from "./components/ShipMap"
import ShipList from "./components/ShipList"
import UpcomingShips from "./components/UpcomingShips"
import ShipLog from "./components/ShipLog"
import NotificationPanel from "./components/NotificationPanel"
import ShipCam from "./components/ShipCam"
import type { ShipCamSize } from "./components/ShipCam"
import StatusBar from "./components/StatusBar"
import TvMode from "./components/TvMode"
import ComponentErrorBoundary from "./components/ComponentErrorBoundary"
import { useAISStream } from "./hooks/useAISStream"
import { useTheme } from "./hooks/useTheme"
import { useIdle } from "./hooks/useIdle"
import { useTvShips } from "./hooks/useTvShips"
import { isInTrackingBounds } from "./utils/geo"
import type { TrackedShip } from "./types/ais"

// TV mode hides the buttons and the cursor after this long without movement
const TV_IDLE_MS = 3000

// "?tv" opens straight into TV mode, for a screen that's left on;
// "?tv=<cam id>" picks the cam
function setTvParam(on: boolean): void {
  const url = new URL(window.location.href)
  if (on) url.searchParams.set("tv", url.searchParams.get("tv") ?? "")
  else url.searchParams.delete("tv")
  window.history.replaceState(null, "", url)
}

function App() {
  const {
    ships,
    notifications,
    connectionStatus,
    feeds,
    shipLog,
    aircraft,
    dismissNotification,
    clearNotifications,
  } = useAISStream()

  // The subscription covers a wide area for "Coming up"; the vessel list
  // sticks to ships around the bridge
  const nearbyShips = useMemo(
    () =>
      new Map(
        Array.from(ships).filter(([, ship]) =>
          isInTrackingBounds(ship.latitude, ship.longitude),
        ),
      ),
    [ships],
  )

  const { theme, toggleTheme } = useTheme()
  const [selectedShip, setSelectedShip] = useState<TrackedShip | null>(null)
  const [showShipList, setShowShipList] = useState(true)
  const [showShipCam, setShowShipCam] = useState(false)
  const [shipCamSize, setShipCamSize] = useState<ShipCamSize | null>(null)
  const [tvCam] = useState(() =>
    new URLSearchParams(window.location.search).get("tv"),
  )
  const [tvMode, setTvMode] = useState(tvCam !== null)
  const idle = useIdle(TV_IDLE_MS, tvMode)
  const tvShips = useTvShips(ships, tvMode)
  // The map's bearing, for TV mode's direction arrow, set straight on the
  // element rather than through state, as it changes every frame
  const tvLayerRef = useRef<HTMLDivElement>(null)
  const handleBearingChange = useCallback((bearing: number) => {
    tvLayerRef.current?.style.setProperty("--map-bearing", `${bearing}deg`)
  }, [])

  const enterTvMode = useCallback(() => {
    setTvMode(true)
    setSelectedShip(null)
    setTvParam(true)
    document.documentElement.requestFullscreen?.().catch(() => {
      // Fullscreen can be refused; TV mode still fills the window
    })
  }, [])

  const exitTvMode = useCallback(() => {
    setTvMode(false)
    setTvParam(false)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    if (!tvMode) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") exitTvMode()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [tvMode, exitTvMode])

  const handleShipCamResize = useCallback((size: ShipCamSize | null) => {
    setShipCamSize((prev) =>
      prev?.width === size?.width && prev?.height === size?.height ? prev : size,
    )
  }, [])

  const [notifPermission, setNotifPermission] = useState(() => {
    if (!("Notification" in window)) return "unsupported"
    return Notification.permission
  })

  const requestNotifications = useCallback(() => {
    globalThis.Notification?.requestPermission().then((perm) => {
      setNotifPermission(perm)
    })
  }, [])

  const handleSelectShip = useCallback((ship: TrackedShip | null) => {
    setSelectedShip(ship)
  }, [])

  return (
    <div
      className={`flex flex-col h-screen overflow-hidden ${theme === "dark" ? "dark" : ""} ${idle ? "cursor-none **:cursor-none" : ""}`}
    >
      {!tvMode && (
        <header className="flex items-center justify-between px-5 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-600 shrink-0">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              BridgeView AIS
            </h1>
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Blue Water Bridge Ship Tracker
            </span>
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
              className={`p-2 rounded-md transition-colors ${showShipCam ? "bg-slate-200 dark:bg-slate-700" : "bg-transparent"} hover:bg-slate-200 dark:hover:bg-slate-700`}
              onClick={() => setShowShipCam((v) => !v)}
              aria-label={showShipCam ? "Hide ship cam" : "Show ship cam"}
              aria-pressed={showShipCam}
              title={showShipCam ? "Hide ship cam" : "Show Port Huron ship cam"}
            >
              <VideoCameraIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </Button>
            <Button
              className="p-2 rounded-md transition-colors bg-transparent hover:bg-slate-200 dark:hover:bg-slate-700"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <SunIcon className="w-5 h-5 text-slate-400 dark:text-slate-400" />
              ) : (
                <MoonIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              )}
            </Button>
            <Button
              className="p-2 rounded-md transition-colors bg-transparent hover:bg-slate-200 dark:hover:bg-slate-700"
              onClick={enterTvMode}
              aria-label="TV mode"
              title="TV mode: full-screen map that switches to the ship cam as ships go by"
            >
              <TvIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </Button>
            <StatusBar connectionStatus={connectionStatus} feeds={feeds} />
          </div>
        </header>
      )}

      <main className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0">
          <ComponentErrorBoundary componentName="Map">
            <ShipMap
              ships={ships}
              aircraft={aircraft}
              // TV mode picks the ships to show itself; a click there
              // mustn't take the camera off its chase view
              selectedShip={tvMode ? null : selectedShip}
              onSelectShip={tvMode ? undefined : handleSelectShip}
              theme={theme}
              showShipList={showShipList && !tvMode}
              onToggleShipList={() => setShowShipList((v) => !v)}
              shipCamSize={tvMode ? null : shipCamSize}
              hideControls={idle}
              tvMode={tvMode}
              onBearingChange={tvMode ? handleBearingChange : undefined}
              // Behind the cam, the map heads back to the bridge so it's
              // there when the cam goes
              followShip={tvShips.passing ? null : tvShips.approaching?.ship}
              chase={!!tvShips.following}
            />
          </ComponentErrorBoundary>
          {tvMode && (
            <div ref={tvLayerRef} className="contents">
              <ComponentErrorBoundary componentName="TV Mode">
                <TvMode
                  {...tvShips}
                  idle={idle}
                  camId={tvCam}
                  onExit={exitTvMode}
                />
              </ComponentErrorBoundary>
            </div>
          )}
          {/* Above the map controls; alerts after it stay on top */}
          {showShipCam && !tvMode && (
            <ComponentErrorBoundary componentName="Ship Cam">
              <ShipCam
                onClose={() => setShowShipCam(false)}
                onResize={handleShipCamResize}
              />
            </ComponentErrorBoundary>
          )}
          {!tvMode && (
            <NotificationPanel
              notifications={notifications}
              onDismiss={dismissNotification}
              onClear={clearNotifications}
              onSelectShip={(mmsi) => {
                const ship = ships.get(mmsi)
                if (ship) handleSelectShip(ship)
              }}
            />
          )}
          {connectionStatus === "connecting" && ships.size === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-50">
              <div className="flex flex-col items-center gap-3 px-6 py-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-300 dark:border-slate-600 shadow-xl">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <p className="text-slate-800 dark:text-slate-200 font-medium">
                  Connecting to AIS stream...
                </p>
              </div>
            </div>
          )}
        </div>
        {!tvMode && (
          <aside
            className={`ship-list-panel absolute top-0 right-0 bottom-0 w-95 md:w-115 overflow-y-auto bg-slate-200/30 dark:bg-slate-800/30 backdrop-blur-sm z-10 max-md:w-full max-md:top-auto max-md:h-[50vh] max-md:border-t max-md:border-slate-300/50 dark:max-md:border-slate-600/50 transition-transform duration-300 ease-in-out ${showShipList ? "translate-x-0" : "translate-x-full"}`}
          >
            <ComponentErrorBoundary componentName="Coming Up">
              <UpcomingShips
                ships={ships}
                selectedShip={selectedShip}
                onSelectShip={handleSelectShip}
                hidden={!showShipList}
              />
            </ComponentErrorBoundary>
            <ComponentErrorBoundary componentName="Ship Log">
              <ShipLog
                log={shipLog}
                ships={ships}
                selectedShip={selectedShip}
                onSelectShip={handleSelectShip}
                hidden={!showShipList}
              />
            </ComponentErrorBoundary>
            <ComponentErrorBoundary componentName="Vessel List">
              <ShipList
                ships={nearbyShips}
                log={shipLog}
                selectedShip={selectedShip}
                onSelectShip={handleSelectShip}
                hidden={!showShipList}
                onClose={() => setShowShipList(false)}
              />
            </ComponentErrorBoundary>
          </aside>
        )}
      </main>
    </div>
  )
}

export default App
