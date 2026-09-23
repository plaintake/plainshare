import { expect, test } from '@playwright/test'
import {
  adminToken,
  createProducer,
  makeTestVideo,
  rotateProducerKey,
  TEST_CAPTIONS,
  uploadVideo,
} from './helpers/upload'

const base = 'http://localhost:8787'

let slug: string
let producerId: string
let key1: string
let key2: string
let video: { path: string; sha256: string; id: string; durationMs: number }

test.beforeAll(async () => {
  const producer = await createProducer(base, 'e2e-rotate')
  slug = producer.slug
  key1 = producer.key
  video = await makeTestVideo('rotate')
  await uploadVideo(base, key1, video, { captions: true })
})

test('/me resolves a fresh key to its producer', async ({ request }) => {
  const response = await request.get('/api/producers/me', {
    headers: { authorization: `Bearer ${key1}` },
  })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as Record<string, unknown>
  expect(body.slug).toBe(slug)
  expect(typeof body.id).toBe('string')
  expect(typeof body.name).toBe('string')
  expect('keyHash' in body).toBe(false)
  producerId = body.id as string
})

test('re-issue returns a fresh key for the same row', async () => {
  const producer = await rotateProducerKey(base, slug)
  key2 = producer.key
  expect(key2).toMatch(/^sk_[0-9a-f]{24}$/)
  expect(key2).not.toBe(key1)
  expect(producer.slug).toBe(slug)
})

test('the old key is revoked immediately', async ({ request }) => {
  const me = await request.get('/api/producers/me', {
    headers: { authorization: `Bearer ${key1}` },
  })
  expect(me.status()).toBe(401)
  expect(await me.json()).toEqual({ error: 'unauthorized' })

  // Write access went with it: sidecars POST rejects the dead key.
  const sidecars = await request.post(`/api/videos/${video.id}/sidecars`, {
    headers: { authorization: `Bearer ${key1}` },
    multipart: {
      captions: { name: 'captions.vtt', mimeType: 'text/vtt', buffer: Buffer.from(TEST_CAPTIONS) },
    },
  })
  expect(sidecars.status()).toBe(401)
})

test('the new key works and owns the videos the old one uploaded', async ({ request }) => {
  const me = await request.get('/api/producers/me', {
    headers: { authorization: `Bearer ${key2}` },
  })
  expect(me.status()).toBe(200)
  const body = (await me.json()) as { id: string; slug: string }
  expect(body.id).toBe(producerId)
  expect(body.slug).toBe(slug)

  // Same row means same producerId — the sidecars POST is authorized, not 403.
  const sidecars = await request.post(`/api/videos/${video.id}/sidecars`, {
    headers: { authorization: `Bearer ${key2}` },
    multipart: {
      captions: { name: 'captions.vtt', mimeType: 'text/vtt', buffer: Buffer.from(TEST_CAPTIONS) },
    },
  })
  expect(sidecars.status()).toBe(200)
})

test('re-issue rejects unknown and malformed slugs', async ({ request }) => {
  const token = await adminToken()
  const unknown = await request.post('/api/producers/no-such-producer/reissue', {
    headers: { 'x-admin-token': token },
  })
  expect(unknown.status()).toBe(404)
  expect(await unknown.json()).toEqual({ error: 'not-found' })

  const malformed = await request.post('/api/producers/UPPER/reissue', {
    headers: { 'x-admin-token': token },
  })
  expect(malformed.status()).toBe(400)
  expect(await malformed.json()).toEqual({ error: 'invalid-slug' })
})

test('re-issue without the admin token is unauthorized', async ({ request }) => {
  const response = await request.post(`/api/producers/${slug}/reissue`)
  expect(response.status()).toBe(401)
  expect(await response.json()).toEqual({ error: 'unauthorized' })
})
