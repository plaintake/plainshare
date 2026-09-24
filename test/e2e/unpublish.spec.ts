import { expect, test } from '@playwright/test'
import {
  adminToken,
  createProducer,
  makeTestVideo,
  putVideo,
  runRetention,
  uploadVideo,
} from './helpers/upload'

const base = 'http://localhost:8787'

type TestVideo = { path: string; sha256: string; id: string; durationMs: number }

let ownerKey: string
let otherKey: string
let video: TestVideo
let takedown: TestVideo
let purgeMe: TestVideo

const bearer = (key: string) => ({ authorization: `Bearer ${key}` })

test.beforeAll(async () => {
  ownerKey = (await createProducer(base, 'e2e-unpublish')).key
  otherKey = (await createProducer(base, 'e2e-unpublish-other')).key
  video = await makeTestVideo('unpublish')
  await uploadVideo(base, ownerKey, video, { captions: true, chapters: true, poster: true })
  takedown = await makeTestVideo('takedown')
  await uploadVideo(base, ownerKey, takedown, {})
  purgeMe = await makeTestVideo('purge')
  await uploadVideo(base, ownerKey, purgeMe, { captions: true })
})

test('unpublish needs the owner or the admin', async ({ request }) => {
  const anonymous = await request.delete(`/api/videos/${video.id}`)
  expect(anonymous.status()).toBe(401)

  const other = await request.delete(`/api/videos/${video.id}`, { headers: bearer(otherKey) })
  expect(other.status()).toBe(403)
  expect(await other.json()).toEqual({ error: 'forbidden' })

  const badAdmin = await request.delete(`/api/videos/${video.id}`, {
    headers: { 'x-admin-token': 'wrong' },
  })
  expect(badAdmin.status()).toBe(401)

  expect((await request.head(`/api/videos/${video.id}`)).status()).toBe(200)
})

test('owner unpublish tombstones the video: every read path answers 410', async ({ request }) => {
  const response = await request.delete(`/api/videos/${video.id}`, { headers: bearer(ownerKey) })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { deletedAt: string; deletedBy: string; purgeAfter: string }
  expect(body.deletedBy).toBe('producer')
  const graceMs = Date.parse(body.purgeAfter) - Date.parse(body.deletedAt)
  expect(graceMs).toBe(30 * 24 * 60 * 60 * 1000)

  expect((await request.head(`/api/videos/${video.id}`)).status()).toBe(410)
  const meta = await request.get(`/api/videos/${video.id}`)
  expect(meta.status()).toBe(410)
  expect(await meta.json()).toEqual({ error: 'unpublished' })
  for (const path of ['media', 'captions', 'poster']) {
    expect((await request.get(`/api/${path}/${video.id}`)).status(), path).toBe(410)
  }
  expect((await request.post(`/api/view/${video.id}`, { data: { viewerId: 'x' } })).status()).toBe(410)

  const sidecars = await request.post(`/api/videos/${video.id}/sidecars`, {
    headers: bearer(ownerKey),
    multipart: { title: 'nope' },
  })
  expect(sidecars.status()).toBe(410)

  // Idempotent: the tombstone keeps its original date.
  const again = await request.delete(`/api/videos/${video.id}`, { headers: bearer(ownerKey) })
  expect(((await again.json()) as { deletedAt: string }).deletedAt).toBe(body.deletedAt)
})

test('the share page says the video is gone, with a 410', async ({ page, request }) => {
  const response = await request.get(`/${video.id}`)
  expect(response.status()).toBe(410)

  await page.goto(`/${video.id}`)
  await expect(page.getByRole('heading', { name: 'Video unavailable' })).toBeVisible()
  await expect(page.getByText('This video has been removed.')).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
})

test('restore brings it back', async ({ request }) => {
  const restored = await request.post(`/api/videos/${video.id}/restore`, { headers: bearer(ownerKey) })
  expect(restored.status()).toBe(200)
  expect(((await restored.json()) as { expiresAt: string | null }).expiresAt).toBeNull()

  expect((await request.get(`/api/media/${video.id}`)).status()).toBe(200)
  expect((await request.get(`/${video.id}`)).status()).toBe(200)

  // Restoring a live video is a no-op, not an error.
  const again = await request.post(`/api/videos/${video.id}/restore`, { headers: bearer(ownerKey) })
  expect(again.status()).toBe(200)
})

test('re-publishing the same bytes restores an unpublished video', async ({ request }) => {
  await request.delete(`/api/videos/${video.id}`, { headers: bearer(ownerKey) })
  expect((await request.head(`/api/videos/${video.id}`)).status()).toBe(410)

  const put = await putVideo(base, ownerKey, video)
  expect(put.status).toBe(200)
  expect(await put.json()).toMatchObject({ deduped: true, restored: true })
  expect((await request.head(`/api/videos/${video.id}`)).status()).toBe(200)

  // Another producer still cannot claim the id.
  expect((await putVideo(base, otherKey, video)).status).toBe(409)
})

test('an admin takedown locks the owner out of restoring', async ({ request }) => {
  const admin = { 'x-admin-token': await adminToken() }

  // An owner unpublish first, then the admin escalates it.
  await request.delete(`/api/videos/${takedown.id}`, { headers: bearer(ownerKey) })
  const escalated = await request.delete(`/api/videos/${takedown.id}`, { headers: admin })
  expect(((await escalated.json()) as { deletedBy: string }).deletedBy).toBe('admin')

  const ownerRestore = await request.post(`/api/videos/${takedown.id}/restore`, { headers: bearer(ownerKey) })
  expect(ownerRestore.status()).toBe(403)
  expect(await ownerRestore.json()).toEqual({ error: 'taken-down' })

  const ownerPut = await putVideo(base, ownerKey, takedown)
  expect(ownerPut.status).toBe(403)
  expect(await ownerPut.json()).toEqual({ error: 'taken-down' })

  const adminRestore = await request.post(`/api/videos/${takedown.id}/restore`, { headers: admin })
  expect(adminRestore.status()).toBe(200)
  expect((await request.head(`/api/videos/${takedown.id}`)).status()).toBe(200)
})

test('expiry: rejected when malformed, settable via sidecars, clearable', async ({ request }) => {
  const bad = await putVideo(base, ownerKey, video, { 'x-expires-at': 'tomorrow' })
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'invalid-expires-at' })

  const past = await request.post(`/api/videos/${video.id}/sidecars`, {
    headers: bearer(ownerKey),
    multipart: { expiresAt: '2000-01-01T00:00:00Z' },
  })
  expect(past.status()).toBe(400)

  const future = new Date(Date.now() + 86_400_000).toISOString()
  const set = await request.post(`/api/videos/${video.id}/sidecars`, {
    headers: bearer(ownerKey),
    multipart: { expiresAt: future },
  })
  expect(set.status()).toBe(200)
  expect(((await set.json()) as { expiresAt: string }).expiresAt).toBe(future)
  expect(((await (await request.get(`/api/videos/${video.id}`)).json()) as { expiresAt: string }).expiresAt).toBe(future)

  const cleared = await request.post(`/api/videos/${video.id}/sidecars`, {
    headers: bearer(ownerKey),
    multipart: { expiresAt: 'none' },
  })
  expect(((await cleared.json()) as { expiresAt: string | null }).expiresAt).toBeNull()
})

test('a video goes dark the moment its expiry passes, before any sweep', async ({ page, request }) => {
  const expiring = await makeTestVideo('expiring')
  const expiresAt = new Date(Date.now() + 3_000).toISOString()
  await uploadVideo(base, ownerKey, expiring, {}, { 'x-expires-at': expiresAt })
  expect((await request.head(`/api/videos/${expiring.id}`)).status()).toBe(200)

  await expect.poll(async () => (await request.head(`/api/videos/${expiring.id}`)).status(), {
    timeout: 10_000,
  }).toBe(410)
  const meta = await request.get(`/api/videos/${expiring.id}`)
  expect(await meta.json()).toEqual({ error: 'expired' })
  expect((await request.get(`/api/media/${expiring.id}`)).status()).toBe(410)

  await page.goto(`/${expiring.id}`)
  await expect(page.getByText('This share link has expired.')).toBeVisible()
})

test('retention purges tombstones past the grace: rows and objects are gone', async ({ request }) => {
  await request.delete(`/api/videos/${purgeMe.id}`, { headers: bearer(ownerKey) })

  // The default 30-day grace leaves a fresh tombstone alone.
  await runRetention(base, 30)
  expect((await request.head(`/api/videos/${purgeMe.id}`)).status()).toBe(410)

  const result = await runRetention(base, 0)
  expect(result.purged).toBeGreaterThanOrEqual(1)

  const meta = await request.get(`/api/videos/${purgeMe.id}`)
  expect(meta.status()).toBe(404)
  expect((await request.get(`/api/media/${purgeMe.id}`)).status()).toBe(404)
  expect((await request.post(`/api/videos/${purgeMe.id}/restore`, { headers: bearer(ownerKey) })).status()).toBe(404)

  // The id is free again: the same bytes now upload fresh, by anyone.
  const fresh = await putVideo(base, otherKey, purgeMe)
  expect(fresh.status).toBe(201)
  expect(await fresh.json()).toMatchObject({ deduped: false })
})

test('retention is admin-only', async ({ request }) => {
  expect((await request.post('/api/admin/retention')).status()).toBe(401)
})
