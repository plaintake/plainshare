/**
 * WebVTT parsing for the transcript panel. Captions are stored and served
 * byte-identical; this parser exists so the share page can SSR cues for the
 * transcript (and search engines) without the browser parsing VTT.
 *
 * Deliberately strict: a malformed file is rejected with a line number at
 * upload time (validateVttOrThrow) rather than half-rendering later.
 */
export type VttCue = { startMs: number; endMs: number; text: string }

export class VttError extends Error {}

const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/

function parseTimestamp(raw: string): number | null {
  const match = TIMESTAMP.exec(raw.trim())
  if (!match) return null
  const hours = match[1] === undefined ? 0 : Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2]!, 10)
  const seconds = Number.parseInt(match[3]!, 10)
  const millis = Number.parseInt(match[4]!, 10)
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
}

/** Strips voice/span/timestamp/class tags for plain transcript text. */
function stripTags(line: string): string {
  return line.replace(/<[^>]*>/g, '')
}

export function parseVtt(input: string): VttCue[] {
  const text = input.replace(/^﻿/, '')
  const lines = text.split(/\r\n|\r|\n/)
  const cues: VttCue[] = []

  let index = 0
  const next = (): string | undefined => lines[index]
  const advance = (): void => {
    index += 1
  }

  // The header line must start with WEBVTT (an optional block follows it).
  while (next() !== undefined && next()!.trim() === '') advance()
  if (next() === undefined || !next()!.startsWith('WEBVTT')) {
    throw new VttError('line 1: file does not start with a WEBVTT header')
  }
  advance()

  let blockStart = index + 1
  while (next() !== undefined) {
    // Blank separators between blocks.
    while (next() !== undefined && next()!.trim() === '') {
      advance()
      blockStart = index + 1
    }
    if (next() === undefined) break

    // Collect one block of non-blank lines.
    const block: string[] = []
    while (next() !== undefined && next()!.trim() !== '') {
      block.push(next()!)
      advance()
    }

    const first = block[0]!.trim()
    if (first.startsWith('NOTE') || first.startsWith('STYLE') || first.startsWith('REGION')) {
      continue
    }

    const timingIndex = block.findIndex((line) => line.includes('-->'))
    const headerProblem = `${blockStart}: block is not a cue (no --> line)`
    if (timingIndex === -1) {
      throw new VttError(headerProblem)
    }
    const timing = block[timingIndex]!
    const arrow = timing.split('-->')
    const start = parseTimestamp(arrow[0] ?? '')
    const end = parseTimestamp((arrow[1] ?? '').trim().split(/\s+/)[0] ?? '')
    if (start === null || end === null) {
      throw new VttError(`${blockStart + timingIndex}: unparseable cue timing "${timing.trim()}"`)
    }
    if (start >= end) {
      throw new VttError(`${blockStart + timingIndex}: cue ends at ${end}ms after starting at ${start}ms`)
    }

    const payload = block
      .slice(timingIndex + 1)
      .map(stripTags)
      .join('\n')
      .trim()
    cues.push({ startMs: start, endMs: end, text: payload })
    blockStart = index + 1
  }

  return cues
}

/** Upload-path validation: at least one well-formed cue, nothing half-parsed. */
export function validateVttOrThrow(input: string): VttCue[] {
  const cues = parseVtt(input)
  if (cues.length === 0) {
    throw new VttError('file contains no cues')
  }
  return cues
}
