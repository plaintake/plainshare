/**
 * Content-addressed video ids: lowercase RFC 4648 base32, no padding, of bytes
 * 0–15 of the MP4's sha256 — always exactly 26 chars.
 *
 * The server never decodes ids. It encodes a digest's first 16 bytes and
 * string-compares, so a non-canonical id (non-zero trailing pad bits) simply
 * never matches and is rejected. The same ~15-line encoder ships in
 * plaintake's @plaintake/publish; the shared test vector (sha256 of the empty
 * string) keeps the two implementations from drifting.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export const VIDEO_ID_PATTERN = /^[a-z2-7]{26}$/

export function isVideoId(id: string): boolean {
  return VIDEO_ID_PATTERN.test(id)
}

export function base32Lower(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  // 16 bytes = 128 bits = 25 full chars + 3 leftover bits, zero-padded into a
  // 26th char. Only ever produced by this encoder; never parsed back.
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31]
  }
  return out
}

/** First 16 bytes of a sha256 hex string as a video id, or null if malformed. */
export function videoIdFromSha256Hex(hex: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return base32Lower(bytes)
}
