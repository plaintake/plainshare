import type { ReactNode } from 'react'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { ThemeToggle } from '../components/theme-toggle'
import appCss from '../styles.css?url'

/**
 * Applies the visitor's theme before first paint: their stored choice if they
 * made one, otherwise the system preference, otherwise dark. Inline and a
 * classic script (no type=module) so it runs while the HTML is still parsing —
 * after the stylesheet has loaded but before the body paints, which is what
 * keeps a light-mode visitor from seeing a dark flash.
 *
 * Must stay in sync with the palette tokens in styles.css and the key the
 * ThemeToggle persists to.
 */
const THEME_INIT = `(function(){var t;try{t=localStorage.getItem('plainshare:theme')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)})()`

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script in <head> sets data-theme on
    // this element before hydration, so its attributes legitimately differ
    // from what the server rendered. One level deep — exactly the mutation
    // the script owns, nothing below it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {/* Here rather than in a page: one non-essential corner control
            shared by every route. */}
        <ThemeToggle />
        <Scripts />
      </body>
    </html>
  )
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'PlainShare' },
      { name: 'description', content: 'Share captioned, chaptered videos with a link.' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Crect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%23101010%22/%3E%3Cpath d=%22M6 4.5v7l6-3.5z%22 fill=%22%238ab4f8%22/%3E%3C/svg%3E' },
    ],
    scripts: [{ children: THEME_INIT }],
  }),
  shellComponent: RootDocument,
})
