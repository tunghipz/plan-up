import { describe, expect, it, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

import { listFolderVersions, readFolderVersion, safetyCopyFilename } from './backup-folder-mobile'

describe('backup-folder-mobile (ios-backup-folder.md)', () => {
  beforeEach(() => invoke.mockReset())

  it('safety copy name is local-time stamped and not a backup name', () => {
    expect(safetyCopyFilename(new Date(2026, 10, 13, 9, 5, 7))).toBe(
      'plan-up-iphone-truoc-khi-mo-2026-11-13-090507.json'
    )
  })

  it('lists versions/ newest first and drops names that are not versions', async () => {
    invoke.mockResolvedValue([
      'plan-up-2026-11-12-145959.json.gz',
      'plan-up-2026-11-13-093554.json.gz',
      'plan-up-2026-11-13.json',
    ])
    const list = await listFolderVersions()
    expect(invoke).toHaveBeenCalledWith('backup_folder_list', { subdir: 'versions' })
    expect(list.map((e) => e.file)).toEqual([
      'plan-up-2026-11-13-093554.json.gz',
      'plan-up-2026-11-12-145959.json.gz',
    ])
  })

  it('reads one snapshot from versions/ and parses it', async () => {
    invoke.mockResolvedValue('{"version":6,"projects":[]}')
    const p = await readFolderVersion('plan-up-2026-11-13-093554.json.gz')
    expect(invoke).toHaveBeenCalledWith('backup_folder_read', {
      fileName: 'plan-up-2026-11-13-093554.json.gz',
      subdir: 'versions',
    })
    expect(p.projects).toEqual([])
  })
})
