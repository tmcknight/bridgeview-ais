import { useState } from "react"
import type { FormEvent } from "react"
import { login } from "./api"

interface LoginFormProps {
  onLogin: () => void
}

/** Asks for the admin password */
export default function LoginForm({ onLogin }: LoginFormProps) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      setPassword("")
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-sm mx-auto mt-16 flex flex-col gap-3 p-5">
      <label htmlFor="admin-password" className="text-sm font-medium">
        Password
      </label>
      <input
        id="admin-password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
      />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Logging in…" : "Log in"}
      </button>
    </form>
  )
}
