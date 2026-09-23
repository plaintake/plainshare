import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ShareViewer } from '@/components/share-viewer'
import { loadShareData } from '@/lib/share-data.server'

/**
 * The share page. Data resolution lives in share-data.server.ts and is reached
 * through createServerFn — the compiler extracts the handler (and its
 * workerd-only imports) into the server bundle, so the client graph never sees
 * `cloudflare:workers`.
 *
 * `loader` must be listed before `head`: head's loaderData is inferred from the
 * loader's return type, and with head first TypeScript's contextual inference
 * collapses it (every downstream useLoaderData types as undefined).
 */
const loadShare = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data }) => loadShareData(data))

export const Route = createFileRoute('/$id')({
  loader: async ({ params }) => {
    const data = await loadShare({ data: params.id })
    if (data === null) throw notFound()
    return data
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: loaderData.video.title ?? loaderData.video.filename },
          { property: 'og:title', content: loaderData.video.title ?? loaderData.video.filename },
          { property: 'og:type', content: 'video.other' },
          { property: 'og:video', content: loaderData.video.mediaUrl },
          ...(loaderData.video.hasPoster
            ? [{ property: 'og:image', content: loaderData.video.posterUrl }]
            : []),
          {
            property: 'og:description',
            content: loaderData.producer
              ? `A video shared with PlainShare by ${loaderData.producer.name}.`
              : 'A video shared with PlainShare.',
          },
        ]
      : [],
  }),
  component: ShareRoute,
})

function ShareRoute() {
  const data = Route.useLoaderData()
  return (
    <ShareViewer
      video={data.video}
      producer={data.producer}
      cues={data.cues}
      chapters={data.chapters}
      initialViews={data.initialViews}
    />
  )
}
