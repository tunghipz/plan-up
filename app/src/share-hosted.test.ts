import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { slugify, suffixFromPath } from './share-hosted'
import { db, getShareForRef, saveShareRecord, deleteShareRecord } from './db'
import type { ShareRecord } from './types'

// Pure link grammar for the hosted share store, plus the local `shares` record
// CRUD against a real (fake) IndexedDB. See design-docs/hosted-share-link.md.

describe('slugify', () => {
  it('lowercases + dashes an ASCII name', () => {
    expect(slugify('Q3 Launch')).toBe('q3-launch')
  })
  it('strips Vietnamese diacritics (incl. đ/Đ)', () => {
    expect(slugify('Kế hoạch Q3')).toBe('ke-hoach-q3')
    expect(slugify('Đội Đỏ')).toBe('doi-do')
  })
  it('collapses punctuation runs and trims dashes', () => {
    expect(slugify('  Hello --- World!!!  ')).toBe('hello-world')
  })
  it('falls back to "plan" when nothing usable remains', () => {
    expect(slugify('★☆✦')).toBe('plan')
    expect(slugify('   ')).toBe('plan')
  })
  it('caps length at 40 with no trailing dash', () => {
    const s = slugify('a'.repeat(60))
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('suffixFromPath', () => {
  it('takes the segment after the LAST dash (slug may contain dashes)', () => {
    expect(suffixFromPath('/view/q3-launch-a7k2p9')).toBe('a7k2p9')
    expect(suffixFromPath('/view/my-big-plan-x-abcdef')).toBe('abcdef')
  })
  it('accepts a bare id with no slug', () => {
    expect(suffixFromPath('/view/a7k2p9')).toBe('a7k2p9')
  })
  it('tolerates a trailing slash', () => {
    expect(suffixFromPath('/view/q3-launch-a7k2p9/')).toBe('a7k2p9')
  })
  it('rejects non-/view paths and empty ids', () => {
    expect(suffixFromPath('/')).toBeNull()
    expect(suffixFromPath('/view/')).toBeNull()
    expect(suffixFromPath('/app/foo')).toBeNull()
  })
  it('rejects a malformed (non-base32) id', () => {
    expect(suffixFromPath('/view/plan-ABC_DEF')).toBeNull()
  })
})

describe('shares record CRUD', () => {
  beforeEach(async () => {
    await db.shares.clear()
  })

  const rec = (over: Partial<ShareRecord> = {}): ShareRecord => ({
    id: 'a7k2p9',
    refId: 'sprint-1',
    kind: 'sprint',
    slug: 'q3-launch',
    writeToken: 'secret-token',
    url: 'https://plan-up-eta.vercel.app/view/q3-launch-a7k2p9',
    createdAt: 1,
    updatedAt: 1,
    projectId: 'p1',
    ...over,
  })

  it('finds a saved share by refId', async () => {
    await saveShareRecord(rec())
    const found = await getShareForRef('sprint-1')
    expect(found?.id).toBe('a7k2p9')
    expect(found?.writeToken).toBe('secret-token')
  })

  it('returns undefined for an unshared ref', async () => {
    expect(await getShareForRef('nope')).toBeUndefined()
  })

  it('put() upserts on the same id (re-share overwrites)', async () => {
    await saveShareRecord(rec())
    await saveShareRecord(rec({ slug: 'renamed', url: 'x', updatedAt: 2 }))
    expect(await db.shares.count()).toBe(1)
    expect((await getShareForRef('sprint-1'))?.slug).toBe('renamed')
  })

  it('deletes a share locally', async () => {
    await saveShareRecord(rec())
    await deleteShareRecord('a7k2p9')
    expect(await getShareForRef('sprint-1')).toBeUndefined()
  })
})
