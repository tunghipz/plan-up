// Bounded twin of lz-string's `decompressFromEncodedURIComponent`.
//
// Share blobs come from strangers (a `#s=` link, a hosted snapshot), and LZ
// output grows quadratically with input: a 39 KB blob of one repeated character
// expands to 160 M characters, and a 200 KB blob (MAX_BLOB_LEN) to gigabytes
// — the tab runs out of memory long before any check on the decoded JSON can
// run. This is the same algorithm (lz-string 1.5, MIT), with one addition: it
// stops and returns null as soon as the output would pass `maxLen`, so a bomb
// costs at most `maxLen` characters of memory.
//
// Output is identical to lz-string's for every well-formed input
// (lz-bounded.test.ts checks round trips against the library).

const KEY_URI_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$'
const BASE = new Map<string, number>([...KEY_URI_SAFE].map((ch, i) => [ch, i]))

/**
 * Decompress a `compressToEncodedURIComponent` blob. Returns null when the blob
 * is corrupt or the output would exceed `maxLen` characters. Like lz-string, an
 * empty input returns null and a truncated stream returns ''.
 */
export function decompressUriBounded(input: string, maxLen: number): string | null {
  if (input === '') return null
  const src = input.replace(/ /g, '+')
  const length = src.length
  const RESET = 32
  // Unknown characters read as 0, same as lz-string's `undefined & bit`.
  const next = (i: number): number => BASE.get(src.charAt(i)) ?? 0
  const data = { val: next(0), position: RESET, index: 1 }
  const readBits = (n: number): number => {
    let bits = 0
    let power = 1
    const maxpower = 2 ** n
    while (power !== maxpower) {
      const resb = data.val & data.position
      data.position >>= 1
      if (data.position === 0) {
        data.position = RESET
        data.val = next(data.index++)
      }
      bits |= (resb > 0 ? 1 : 0) * power
      power <<= 1
    }
    return bits
  }

  // Codes 0..2 are control codes (8-bit literal, 16-bit literal, end of stream);
  // dictionary entries start at 3.
  const dictionary: string[] = []
  let enlargeIn = 4
  let dictSize = 4
  let numBits = 3

  let first: string
  switch (readBits(2)) {
    case 0:
      first = String.fromCharCode(readBits(8))
      break
    case 1:
      first = String.fromCharCode(readBits(16))
      break
    case 2:
      return ''
    default:
      return null // code 3 has no meaning in the first position
  }
  dictionary[3] = first
  let w = first
  const result: string[] = [first]
  let outLen = first.length

  for (;;) {
    if (data.index > length) return ''
    let c = readBits(numBits)
    switch (c) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(readBits(8))
        c = dictSize - 1
        enlargeIn--
        break
      case 1:
        dictionary[dictSize++] = String.fromCharCode(readBits(16))
        c = dictSize - 1
        enlargeIn--
        break
      case 2:
        return result.join('')
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }

    let entry: string
    if (dictionary[c]) entry = dictionary[c]
    else if (c === dictSize) entry = w + w.charAt(0)
    else return null

    outLen += entry.length
    if (outLen > maxLen) return null
    result.push(entry)

    dictionary[dictSize++] = w + entry.charAt(0)
    enlargeIn--
    w = entry
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
  }
}
