import { useEffect, useState } from 'react'

const VERSION_URL = '/version.json'
const EVERY_MS = 10 * 60 * 1000

/** Fetch the deployed build id (served no-cache); null when offline or not deployed. */
async function deployedBuild(): Promise<string | null> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { build?: string }
    return typeof data.build === 'string' ? data.build : null
  } catch {
    return null
  }
}

/**
 * True once a newer build than the running one is deployed. A page added to the phone's home screen
 * never reloads by itself and keeps whatever it cached, so without this it can run an old version
 * for days; checked on load, whenever the app comes back to the foreground, and every 10 minutes.
 */
export function useUpdateAvailable(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (import.meta.env.DEV) return
    let stopped = false
    const check = async () => {
      const build = await deployedBuild()
      if (!stopped && build && build !== __BUILD_ID__) setReady(true)
    }
    void check()
    const onVisible = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const timer = setInterval(() => void check(), EVERY_MS)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(timer)
    }
  }, [])
  return ready
}

/** Reload bypassing any cached copy of the page. */
export const reloadApp = () => {
  const url = new URL(location.href)
  url.searchParams.set('v', String(Date.now()))
  location.replace(url.toString())
}
