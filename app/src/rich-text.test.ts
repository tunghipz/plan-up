import { describe, it, expect } from 'vitest'
import {
  marksAt,
  parseRich,
  stripRich,
  isBlankRich,
  sourceIndexFor,
  toggleMark,
  markForKey,
} from './rich-text'

/** Compact assertion helper: "text|marks" per segment. */
const shape = (s: string) => parseRich(s).map((x) => `${x.text}|${x.marks.join(',')}`)

describe('parseRich', () => {
  it('leaves plain text alone', () => {
    expect(shape('7 tháp: pháo, chòi phép')).toEqual(['7 tháp: pháo, chòi phép|'])
  })

  it('parses each mark', () => {
    expect(shape('a **b** c')).toEqual(['a |', 'b|bold', ' c|'])
    expect(shape('a *b* c')).toEqual(['a |', 'b|italic', ' c|'])
    expect(shape('a ~~b~~ c')).toEqual(['a |', 'b|strike', ' c|'])
    expect(shape('a ==b== c')).toEqual(['a |', 'b|mark', ' c|'])
  })

  it('nests marks', () => {
    expect(shape('**bold *both* bold**')).toEqual([
      'bold |bold',
      'both|bold,italic',
      ' bold|bold',
    ])
    expect(shape('***x***')).toEqual(['x|bold,italic'])
    expect(shape('==**hi**==')).toEqual(['hi|mark,bold'])
  })

  it('keeps an unmatched delimiter literal', () => {
    expect(shape('2 * 3 * 4')).toEqual(['2 |', ' 3 |italic', ' 4|'])
    expect(shape('a**b')).toEqual(['a**b|'])
    expect(shape('50% ** done')).toEqual(['50% ** done|'])
  })

  it('does not span a newline', () => {
    expect(shape('a *b\nc* d')).toEqual(['a *b\nc* d|'])
  })

  it('honours the backslash escape', () => {
    expect(shape('2 \\* 3')).toEqual(['2 * 3|'])
    expect(shape('\\**x\\**')).toEqual(['*|', 'x*|italic'])
  })

  it('never produces an empty span — a closer must be at least one char away', () => {
    expect(shape('** **')).toEqual([' |bold'])
    expect(parseRich('****').every((s) => s.text.length > 0)).toBe(true)
  })
})

describe('stripRich / isBlankRich', () => {
  it('removes markers for plain-text sinks', () => {
    expect(stripRich('**7 tháp**: ==pháo==, ~~chòi~~')).toBe('7 tháp: pháo, chòi')
    expect(stripRich('')).toBe('')
  })

  it('treats a title with no visible text as blank', () => {
    expect(isBlankRich('****')).toBe(false) // leftover literal stars ARE visible
    expect(isBlankRich('** **')).toBe(true)
    expect(isBlankRich('  ')).toBe(true)
    expect(isBlankRich('**x**')).toBe(false)
  })

  it('round-trips through search: the stripped text is what the user reads', () => {
    expect(stripRich('siêu **pháo**').includes('pháo')).toBe(true)
  })
})

describe('marksAt', () => {
  it('reports only the marks covering the WHOLE range', () => {
    const src = 'a **b** c'
    expect(marksAt(src, 4, 5)).toEqual(['bold']) // exactly "b"
    expect(marksAt(src, 0, src.length)).toEqual([]) // spans unmarked text too
    expect(marksAt(src, 4, 4)).toEqual([]) // collapsed
  })
})

describe('sourceIndexFor', () => {
  // Clicking the rendered title must land the caret on the same character once
  // the markers come back.
  it('maps a rendered offset back onto the raw string', () => {
    const raw = 'alpha **beta** gamma'
    expect(sourceIndexFor(raw, 0)).toBe(0)
    expect(raw[sourceIndexFor(raw, 6)]).toBe('b') // start of "beta"
    expect(raw[sourceIndexFor(raw, 11)]).toBe('g') // start of "gamma"
    expect(sourceIndexFor(raw, stripRich(raw).length)).toBe(raw.length)
  })

  it('handles a title that starts with a mark', () => {
    const raw = '==pháo== nặng'
    expect(raw[sourceIndexFor(raw, 0)]).toBe('p')
    expect(raw.slice(sourceIndexFor(raw, 4))).toBe(' nặng')
  })
})

describe('toggleMark', () => {
  const tog = (v: string, a: number, b: number, m: Parameters<typeof toggleMark>[3]) =>
    toggleMark(v, a, b, m)

  it('wraps the selection and keeps it around the inner text', () => {
    const r = tog('abc def', 4, 7, 'bold')
    expect(r.value).toBe('abc **def**')
    expect(r.value.slice(r.start, r.end)).toBe('def')
  })

  it('unwraps when markers sit outside the selection', () => {
    const r = tog('abc **def**', 6, 9, 'bold')
    expect(r.value).toBe('abc def')
    expect(r.value.slice(r.start, r.end)).toBe('def')
  })

  it('unwraps when the selection includes the markers', () => {
    const r = tog('abc **def**', 4, 11, 'bold')
    expect(r.value).toBe('abc def')
    expect(r.value.slice(r.start, r.end)).toBe('def')
  })

  it('nests bold + italic instead of breaking the pair', () => {
    const bold = tog('abc', 0, 3, 'bold') // **abc**
    const both = tog(bold.value, bold.start, bold.end, 'italic')
    expect(both.value).toBe('***abc***')
    expect(both.value.slice(both.start, both.end)).toBe('abc')
  })

  it('removes only the mark asked for from a triple run', () => {
    const noItalic = tog('***abc***', 3, 6, 'italic')
    expect(noItalic.value).toBe('**abc**')
    const noBold = tog('***abc***', 3, 6, 'bold')
    expect(noBold.value).toBe('*abc*')
  })

  it('inserts an empty pair with the caret inside when nothing is selected', () => {
    const r = tog('abc', 3, 3, 'mark')
    expect(r.value).toBe('abc====')
    expect(r.start).toBe(5)
    expect(r.end).toBe(5)
  })

  it('removes a mark nested inside other marks', () => {
    // Bold, then highlight stacked on the same word: `alpha **==beta==** gamma`.
    const src = 'alpha **==beta==** gamma'
    const inner = [src.indexOf('beta'), src.indexOf('beta') + 4]
    expect(marksAt(src, inner[0], inner[1]).sort()).toEqual(['bold', 'mark'])
    const unbold = toggleMark(src, inner[0], inner[1], 'bold')
    expect(unbold.value).toBe('alpha ==beta== gamma')
    expect(unbold.value.slice(unbold.start, unbold.end)).toBe('beta')
    const unmark = toggleMark(src, inner[0], inner[1], 'mark')
    expect(unmark.value).toBe('alpha **beta** gamma')
  })

  it('extends the mark (never removes it) when only PART of the range has it', () => {
    const src = 'a **b** c' // "b" bold, " c" plain
    const r = toggleMark(src, 4, 9, 'bold') // range covers both
    expect(r.value).toBe('a **b c**')
    expect(stripRich(r.value)).toBe(stripRich(src)) // visible text never changes
    expect(marksAt(r.value, r.start, r.end)).toEqual(['bold'])
  })

  it('re-serialises canonically instead of splicing stray markers', () => {
    // Bold a range that crosses a highlight boundary — the naive splice used to
    // emit markers that parsed back as literal text.
    const src = 'a ==b== c'
    const r = toggleMark(src, 0, src.length, 'bold')
    expect(stripRich(r.value)).toBe('a b c')
    expect(r.value).toBe('**a ==b== c**')
  })

  it('escapes a literal delimiter that would pair with an emitted one', () => {
    const src = 'a*' // a trailing star, literal today
    const r = toggleMark(src, 0, src.length, 'bold')
    expect(stripRich(r.value)).toBe('a*') // it must STAY literal…
    expect(marksAt(r.value, r.start, r.end)).toEqual(['bold']) // …and the text is bold
    expect(r.value).toBe('**a\\***')
  })

  it('toggles strike and highlight independently', () => {
    const s = tog('abc', 0, 3, 'strike')
    expect(s.value).toBe('~~abc~~')
    const h = tog(s.value, s.start, s.end, 'mark')
    expect(h.value).toBe('~~==abc==~~')
    expect(stripRich(h.value)).toBe('abc')
  })
})

describe('markForKey', () => {
  const k = (key: string, o: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {}) =>
    markForKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...o })

  it('maps the four shortcuts', () => {
    expect(k('b', { metaKey: true })).toBe('bold')
    expect(k('i', { ctrlKey: true })).toBe('italic')
    expect(k('x', { metaKey: true, shiftKey: true })).toBe('strike')
    expect(k('h', { metaKey: true, shiftKey: true })).toBe('mark')
  })

  it('ignores plain keys and unrelated combos', () => {
    expect(k('b')).toBe(null)
    expect(k('s', { metaKey: true })).toBe(null)
    expect(k('b', { metaKey: true, shiftKey: true })).toBe(null)
  })
})
