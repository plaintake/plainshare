import { useEffect, useState } from 'react'

/** Where the visitor's explicit choice lives; absent means "follow the system". */
const STORAGE_KEY = 'plainshare:theme'

type Theme = 'dark' | 'light'

function appliedTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function storeTheme(theme: Theme): void {
  // A private-browsing setItem can throw; the choice still applies for the
  // session, which is the part that matters on a share page.
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* the theme is already applied */
  }
}

/**
 * The dark/light switch. The applied theme lives on `<html data-theme>` — set
 * before first paint by the inline script in the root route's head — so this
 * component only reads it, flips it, and persists the choice.
 *
 * Rendered once in the root shell and, on wide layouts, fixed to the
 * bottom-left corner: theming is not part of watching a video, so the toggle
 * stays out of every page's flow, and bottom-left is the one corner nothing
 * else claims (the share page's right edge is side panels, top to bottom).
 * When the layout stacks, the transcript takes that edge, so the stylesheet
 * moves the toggle into the flow at the end of the page instead.
 *
 * The icon renders after mount: the server cannot know the theme (the
 * visitor's machine chooses it), and an icon that is wrong for one frame is
 * worse than a briefly empty button.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    setTheme(appliedTheme())
    // The system preference stays live until the visitor makes an explicit
    // choice — a stored one wins from then on, which is why the listener
    // checks for it rather than the state it replaced.
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onSystemChange = () => {
      if (localStorage.getItem(STORAGE_KEY) !== null) return
      const next: Theme = media.matches ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      setTheme(next)
    }
    media.addEventListener('change', onSystemChange)
    return () => media.removeEventListener('change', onSystemChange)
  }, [])

  const toggle = () => {
    const next: Theme = (theme ?? appliedTheme()) === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    storeTheme(next)
    setTheme(next)
  }

  const label =
    theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {theme === 'light' ? <MoonIcon /> : theme === 'dark' ? <SunIcon /> : null}
    </button>
  )
}

/** Feather's sun — shown while dark, because it is the way out of it. */
function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

/** Feather's moon — shown while light. */
function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}
