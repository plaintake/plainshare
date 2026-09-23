import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createProducer, makeTestVideo, uploadVideo } from './helpers/upload'

let producerKey: string
let video: { path: string; sha256: string; id: string; durationMs: number }
let bareVideo: { path: string; sha256: string; id: string; durationMs: number }

/** Inputs are inert until React hydrates — interacting sooner races client startup. */
async function waitForHydration(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
}

test.beforeAll(async () => {
  const base = 'http://localhost:8787'
  const producer = await createProducer(base, 'e2e')
  producerKey = producer.key
  video = await makeTestVideo('main')
  await uploadVideo(base, producerKey, video)
  bareVideo = await makeTestVideo('bare')
  await uploadVideo(base, producerKey, bareVideo, {})
})

test('share page renders player, transcript and chapters, and clicks seek', async ({ page }) => {
  await page.goto(`/${video.id}`)
  await waitForHydration(page)

  const element = page.locator('video')
  await expect(element).toBeAttached()
  await expect(element.locator('source')).toHaveAttribute('src', `/api/media/${video.id}`)
  await expect(element.locator('track')).toHaveCount(1)

  // Transcript cues SSR'd and hydrated.
  await expect(page.getByRole('button', { name: /Red frames ahead/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Green takes over/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Blue to finish/ })).toBeVisible()

  // Producer attribution.
  await expect(page.getByText('made with').locator('..').getByRole('link', { name: /E2E/ })).toBeVisible()

  // Click the second cue (2s) — playback jumps there.
  await page.getByRole('button', { name: /Green takes over/ }).click()
  await expect
    .poll(
      async () => page.locator('video').evaluate((el) => Math.floor((el as HTMLVideoElement).currentTime)),
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(2)

  // Click the third chapter (4s) — playback jumps past the cue boundary.
  await page
    .getByRole('region', { name: 'Chapters' })
    .getByRole('button', { name: '0:04 Blue', exact: true })
    .click()
  await expect
    .poll(
      async () => page.locator('video').evaluate((el) => Math.floor((el as HTMLVideoElement).currentTime)),
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(4)

  // The active chapter highlight follows playback.
  await expect(page.locator('.chapter.active')).toContainText('Blue')
})

test('transcript search narrows the list', async ({ page }) => {
  await page.goto(`/${video.id}`)
  await waitForHydration(page)
  await page.getByLabel('Search transcript').fill('green')
  await expect(page.getByRole('button', { name: /Red frames ahead/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Green takes over/ })).toBeVisible()
})

test('a video without sidecars shows the empty transcript state', async ({ page }) => {
  await page.goto(`/${bareVideo.id}`)
  await expect(page.getByText('No captions.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Chapters' })).toHaveCount(0)
})

test('views count once per viewer across reloads', async ({ page }) => {
  // Registered before goto: the counter POSTs as soon as the page hydrates.
  const counted = page.waitForResponse(
    (r) => r.url().endsWith(`/api/view/${video.id}`) && r.request().method() === 'POST',
  )
  await page.goto(`/${video.id}`)
  await waitForHydration(page)
  await counted
  const first = await page.locator('.views').innerText()
  await page.reload()
  await waitForHydration(page)
  const second = await page.locator('.views').innerText()
  expect(second).toBe(first)
})

test('upload whose bytes disagree with the digest leaves nothing behind', async ({ request }) => {
  // Fresh id: declared digest and id agree with clip A, but the body is clip B.
  const a = await makeTestVideo('mismatch-a')
  const b = await makeTestVideo('mismatch-b')
  expect(a.sha256).not.toBe(b.sha256)
  const response = await request.fetch(`/api/videos/${a.id}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${producerKey}`,
      'x-content-sha256': a.sha256,
      'x-filename': 'mismatch.mp4',
    },
    data: await readFile(b.path),
  })
  expect(response.status()).toBe(400)
  // R2's checksum option failed the write atomically: no media, no metadata row.
  expect((await request.get(`/api/media/${a.id}`)).status()).toBe(404)
  expect((await request.get(`/api/videos/${a.id}`)).status()).toBe(404)
})
