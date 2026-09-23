import { describe, expect, it } from 'vitest'
import { VttError, parseVtt, validateVttOrThrow } from './vtt'

describe('parseVtt', () => {
  it('parses a plain two-cue file', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n\n00:00:02.000 --> 00:00:04.500\nGoodbye\n')
    expect(cues).toEqual([
      { startMs: 0, endMs: 2000, text: 'Hello' },
      { startMs: 2000, endMs: 4500, text: 'Goodbye' },
    ])
  })

  it('accepts CRLF line endings, a BOM, and MM:SS.mmm timestamps', () => {
    const cues = parseVtt('﻿WEBVTT\r\n\r\n00:01.500 --> 00:03.000\r\nShort form\r\n')
    expect(cues).toEqual([{ startMs: 1500, endMs: 3000, text: 'Short form' }])
  })

  it('keeps multi-line payloads and strips voice/span tags', () => {
    const cues = parseVtt(
      'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n<v Narrator>Hello <c.highlight>world</c>\nsecond line\n',
    )
    expect(cues).toEqual([{ startMs: 0, endMs: 3000, text: 'Hello world\nsecond line' }])
  })

  it('skips NOTE blocks and cue id lines', () => {
    const cues = parseVtt(
      'WEBVTT\n\nNOTE this is a comment\nspanning lines\n\ncue-1\n00:00:00.000 --> 00:00:01.000\nText\n',
    )
    expect(cues).toEqual([{ startMs: 0, endMs: 1000, text: 'Text' }])
  })

  it('tolerates STYLE and REGION blocks', () => {
    const cues = parseVtt(
      'WEBVTT\n\nSTYLE\n::cue { color: yellow }\n\nREGION\nid:top\n\n00:00:00.000 --> 00:00:01.000\nText\n',
    )
    expect(cues).toEqual([{ startMs: 0, endMs: 1000, text: 'Text' }])
  })

  it('accepts SRT-style comma decimal separators and cue settings', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:00,000 --> 00:00:01,250 align:start\nText\n')
    expect(cues).toEqual([{ startMs: 0, endMs: 1250, text: 'Text' }])
  })

  it('rejects a missing WEBVTT header', () => {
    expect(() => parseVtt('00:00:00.000 --> 00:00:01.000\nText\n')).toThrow(VttError)
  })

  it('rejects unparseable timings with a line number', () => {
    expect(() => parseVtt('WEBVTT\n\n00:00:00 --> 00:00:01.000\nText\n')).toThrow(/^3:/)
  })

  it('rejects cues that end before they start', () => {
    expect(() => parseVtt('WEBVTT\n\n00:00:05.000 --> 00:00:01.000\nText\n')).toThrow(VttError)
  })

  it('rejects a block with no timing line', () => {
    expect(() => parseVtt('WEBVTT\n\njust some words\n')).toThrow(VttError)
  })
})

describe('validateVttOrThrow', () => {
  it('passes through cues from a valid file', () => {
    const cues = validateVttOrThrow('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nText\n')
    expect(cues).toHaveLength(1)
  })

  it('rejects a syntactically valid file with zero cues', () => {
    expect(() => validateVttOrThrow('WEBVTT\n')).toThrow(/no cues/)
  })
})
