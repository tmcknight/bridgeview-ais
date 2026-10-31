import { useCallback, useEffect, useState } from "react"
import { useTheme } from "../hooks/useTheme"
import { AuthError, checkSession, getToken, logout } from "./api"
import LoginForm from "./LoginForm"
import ShipSearch from "./ShipSearch"
import ShipEditor from "./ShipEditor"

type Session = "checking" | "out" | "in"

/**
 * The ship data admin page (/admin): find a ship, correct its details, look
 * it up again, and manage its photos. Not linked from the app; the API needs
 * the admin password.
 */
export default function AdminApp() {
  const { theme } = useTheme()
  const [session, setSession] = useState<Session>(() => (getToken() ? "checking" : "out"))
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    if (session !== "checking") return
    checkSession()
      .then(() => setSession("in"))
      .catch(() => setSession("out"))
  }, [session])

  // Any request can find the session has ended
  const onError = useCallback((err: unknown) => {
    if (err instanceof AuthError) setSession("out")
  }, [])

  return (
    <div className={`flex flex-col h-full overflow-y-auto bg-white dark:bg-slate-900 ${theme === "dark" ? "dark" : ""}`}>
      <header className="flex items-center justify-between px-5 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-600 shrink-0">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">BridgeView admin</h1>
        {session === "in" && (
          <button
            type="button"
            className="border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-md text-xs hover:border-blue-500"
            onClick={() => {
              logout().finally(() => setSession("out"))
            }}
          >
            Log out
          </button>
        )}
      </header>
      <main className="flex-1 text-slate-800 dark:text-slate-200">
        {session === "checking" && <p className="p-5 text-sm text-slate-500">Checking session…</p>}
        {session === "out" && <LoginForm onLogin={() => setSession("in")} />}
        {session === "in" && (
          <div className="flex flex-col md:flex-row gap-4 p-4">
            <ShipSearch selected={selected} onSelect={setSelected} onError={onError} />
            <div className="flex-1 min-w-0">
              {selected === null ? (
                <p className="text-sm text-slate-500 p-4">Pick a ship to edit its details and photos.</p>
              ) : (
                <ShipEditor key={selected} mmsi={selected} onError={onError} />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
