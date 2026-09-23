import { useEffect, useState } from 'react'

export type ViewCounterProps = {
  videoId: string
  initialViews: number
}

const STORAGE_KEY = 'plainshare-viewer-id'

/**
 * Records a view once per viewer per day (the server dedupes further). The
 * server-rendered count paints first so there is no flash.
 */
export function ViewCounter({ videoId, initialViews }: ViewCounterProps) {
  const [views, setViews] = useState(initialViews)

  useEffect(() => {
    let viewerId: string | null = null
    try {
      viewerId = localStorage.getItem(STORAGE_KEY)
      if (viewerId === null) {
        viewerId = crypto.randomUUID()
        localStorage.setItem(STORAGE_KEY, viewerId)
      }
    } catch {
      // Storage unavailable: the server falls back to ip+user-agent identity.
    }
    fetch(`/api/view/${videoId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewerId }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ views?: number }>) : null))
      .then((data) => {
        if (data !== null && typeof data.views === 'number') setViews(data.views)
      })
      .catch(() => {})
  }, [videoId])

  return (
    <span className="views">
      {views.toLocaleString()} {views === 1 ? 'view' : 'views'}
    </span>
  )
}
