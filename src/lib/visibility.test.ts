import { describe, expect, it } from 'vitest'
import { parseExpiresAt, videoState } from './visibility'

const now = new Date('2026-09-24T12:00:00Z')
const past = new Date('2026-09-24T11:00:00Z')
const future = new Date('2026-09-25T12:00:00Z')

describe('videoState', () => {
  it('is live with no tombstone and no expiry', () => {
    expect(videoState({ deletedAt: null, deletedBy: null, expiresAt: null }, now)).toBe('live')
    expect(videoState({ deletedAt: null, deletedBy: null, expiresAt: future }, now)).toBe('live')
  })

  it('is unpublished once tombstoned by the producer or admin', () => {
    expect(videoState({ deletedAt: past, deletedBy: 'producer', expiresAt: null }, now)).toBe('unpublished')
    expect(videoState({ deletedAt: past, deletedBy: 'admin', expiresAt: future }, now)).toBe('unpublished')
  })

  it('is expired the moment expiresAt passes, before any sweep', () => {
    expect(videoState({ deletedAt: null, deletedBy: null, expiresAt: past }, now)).toBe('expired')
    expect(videoState({ deletedAt: null, deletedBy: null, expiresAt: now }, now)).toBe('expired')
  })

  it('stays expired after the sweep tombstones it', () => {
    expect(videoState({ deletedAt: past, deletedBy: 'expired', expiresAt: past }, now)).toBe('expired')
  })
})

describe('parseExpiresAt', () => {
  it('accepts a future ISO instant', () => {
    expect(parseExpiresAt('2026-09-25T12:00:00Z', now)).toEqual(future)
  })

  it('treats none as clear, case-insensitively', () => {
    expect(parseExpiresAt('none', now)).toBe('clear')
    expect(parseExpiresAt(' NONE ', now)).toBe('clear')
  })

  it('rejects past and present instants', () => {
    expect(() => parseExpiresAt('2026-09-24T11:00:00Z', now)).toThrow('future')
    expect(() => parseExpiresAt(now.toISOString(), now)).toThrow('future')
  })

  it('rejects garbage', () => {
    expect(() => parseExpiresAt('tomorrow', now)).toThrow('ISO')
    expect(() => parseExpiresAt('2026-13-45', now)).toThrow('ISO')
    expect(() => parseExpiresAt('', now)).toThrow('ISO')
  })
})
