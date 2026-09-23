import { describe, expect, it } from 'vitest'
import { parseChapters } from './chapters'

describe('parseChapters', () => {
  it('accepts explicit marks and sorts them', () => {
    const chapters = parseChapters(
      [
        { title: 'Second', startMs: 5000, endMs: 9000 },
        { title: 'First', startMs: 0, endMs: 5000 },
      ],
      9000,
    )
    expect(chapters.map((c) => c.title)).toEqual(['First', 'Second'])
  })

  it('fills a missing endMs from the next mark, last from duration', () => {
    const chapters = parseChapters(
      [
        { title: 'Intro', startMs: 0 },
        { title: 'Demo', startMs: 3000 },
      ],
      10000,
    )
    expect(chapters).toEqual([
      { title: 'Intro', startMs: 0, endMs: 3000 },
      { title: 'Demo', startMs: 3000, endMs: 10000 },
    ])
  })

  it('rejects overlapping marks', () => {
    expect(() =>
      parseChapters(
        [
          { title: 'A', startMs: 0, endMs: 6000 },
          { title: 'B', startMs: 5000 },
        ],
        10000,
      ),
    ).toThrow(/inside "A"/)
  })

  it('rejects an end at or before the start', () => {
    expect(() => parseChapters([{ title: 'A', startMs: 1000, endMs: 1000 }])).toThrow(/at or before/)
    expect(() => parseChapters([{ title: 'A', startMs: 1000, endMs: 500 }])).toThrow(/at or before/)
  })

  it('rejects non-object input and bad titles', () => {
    expect(() => parseChapters('nope')).toThrow()
    expect(() => parseChapters([{ title: '', startMs: 0 }])).toThrow()
    expect(() => parseChapters([{ title: 'A', startMs: -1 }])).toThrow()
  })

  it('caps the chapter count', () => {
    const marks = Array.from({ length: 201 }, (_, i) => ({ title: `c${i}`, startMs: i * 1000 }))
    expect(() => parseChapters(marks)).toThrow()
  })
})
