import { describe, it, expect } from 'vitest'
import LZString from 'lz-string'
import { decompressUriBounded } from './lz-bounded'

const BIG = 50_000_000

// Deterministic PRNG so a failure is reproducible.
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

describe('decompressUriBounded', () => {
  it('matches lz-string on round trips (ascii, unicode, repetitive, snapshot-like)', () => {
    const r = rng(7)
    const samples: string[] = [
      'a',
      'hello world',
      'Phân tích bida 🎱 — Tết · #2-5, 8',
      'x'.repeat(10_000),
      JSON.stringify({ v: 2, pj: 'Proj', ti: Array.from({ length: 300 }, (_, i) => `Task ${i}`) }),
    ]
    for (let k = 0; k < 200; k++) {
      const len = Math.floor(r() * 400)
      let s = ''
      for (let i = 0; i < len; i++) {
        // Mix ASCII, Vietnamese and astral code units.
        const pick = r()
        s += pick < 0.7 ? String.fromCharCode(32 + Math.floor(r() * 95))
          : pick < 0.95 ? String.fromCharCode(0x00c0 + Math.floor(r() * 0x1f0))
          : '🎱'
      }
      samples.push(s)
    }
    for (const s of samples) {
      const blob = LZString.compressToEncodedURIComponent(s)
      expect(decompressUriBounded(blob, BIG)).toBe(s)
      expect(decompressUriBounded(blob, BIG)).toBe(LZString.decompressFromEncodedURIComponent(blob))
    }
  })

  it('stops a decompression bomb at maxLen instead of expanding it', () => {
    const bomb = LZString.compressToEncodedURIComponent('a'.repeat(5_000_000)) // ~6 KB blob
    expect(bomb.length).toBeLessThan(10_000)
    expect(decompressUriBounded(bomb, 1_000_000)).toBeNull()
    expect(decompressUriBounded(bomb, 5_000_000)).toHaveLength(5_000_000)
  })

  it('treats garbage like lz-string does: empty → null, never throws', () => {
    expect(decompressUriBounded('', BIG)).toBeNull()
    const r = rng(11)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$ %'
    for (let k = 0; k < 300; k++) {
      let s = ''
      const len = 1 + Math.floor(r() * 60)
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)]
      const out = decompressUriBounded(s, BIG)
      expect(out === null || typeof out === 'string').toBe(true)
    }
  })
})
