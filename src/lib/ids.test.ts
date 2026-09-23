import { describe, expect, it } from 'vitest'
import { base32Lower, isVideoId, videoIdFromSha256Hex } from './ids'

/**
 * Shared vector with plaintake's @plaintake/publish (packages/publish) — the
 * same id derivation in two repos must not drift apart silently.
 */
describe('video ids', () => {
  it('derives the shared vector for sha256 of the empty string', () => {
    const sha256Empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(videoIdFromSha256Hex(sha256Empty)).toBe('4oymiquy7qobjgx36tejs35zeq')
  })

  it('derives the shared vector for sha256("hello")', () => {
    const sha256Hello = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    expect(videoIdFromSha256Hex(sha256Hello)).toBe('ftze3os7wcrq4jxihmvmlopcty')
  })

  it('is always 26 chars of [a-z2-7] over 16 bytes', () => {
    const bytes = new Uint8Array(16).map((_, i) => (i * 17) % 256)
    const id = base32Lower(bytes)
    expect(id).toMatch(/^[a-z2-7]{26}$/)
  })

  it('rejects malformed digests and non-ids', () => {
    expect(videoIdFromSha256Hex('not-a-digest')).toBeNull()
    expect(videoIdFromSha256Hex('E3B0C44298FC1C14'.repeat(4))).toBeNull() // uppercase, wrong length shape
    expect(isVideoId('4oymiquy7qobjgx36tejs35zeq')).toBe(true)
    expect(isVideoId('4oymiquy7qobjgx36tejs35zeqa')).toBe(false) // 27 chars
    expect(isVideoId('4oymiquy7qobjgx36tejs35ze1')).toBe(false) // digit 1 not in alphabet
    expect(isVideoId('')).toBe(false)
  })

  it('never decodes: a non-canonical id simply does not match', () => {
    // The 26th char of the empty-string vector encodes 3 bits + zero padding.
    // Flipping it to an encoding with nonzero pad bits still parses as an id,
    // but re-encoding a digest can never produce it.
    const sha256Empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const canonical = videoIdFromSha256Hex(sha256Empty)!
    const lastChar = canonical[25]!
    expect(lastChar).toBe('q') // binary 10001<<2 — see base32Lower
    // 'r' differs from 'q' only in the zero-pad bits; still shape-valid:
    expect(isVideoId(`${canonical.slice(0, 25)}r`)).toBe(true)
    // ...but no digest ever encodes to it, so PUT with it fails the pre-flight.
  })
})
