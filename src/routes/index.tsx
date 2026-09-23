import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <main className="landing">
      <h1>PlainShare</h1>
      <p>Share captioned, chaptered videos with a link.</p>
      <p className="landing-note">
        Videos live at a content-addressed URL: the id is the hash of the video itself, so the
        same bytes always mean the same link. Captions are searchable and clickable; chapters
        jump you straight to the part that matters.
      </p>
      <p><a href="https://github.com/plaintake/plainshare">Source</a>.</p>
    </main>
  )
}
