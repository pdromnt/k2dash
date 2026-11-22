import { describe, expect, it, vi } from 'vitest'
import {
  cleanConfigBackups,
  isPrinterConfigBackup,
  planConfigBackupCleanup,
  referencedConfigBackups,
  type ConfigFileEntry,
} from './configBackups'

const backup = (n: number): ConfigFileEntry => ({
  path: `printer-202610${String(n).padStart(2, '0')}_194632.cfg`,
  size: 100,
  modified: n,
})
const files = Array.from({ length: 8 }, (_, i) => backup(i + 1))
const deps = () => ({
  list: vi.fn(async () => files),
  read: vi.fn(async () => ''),
  remove: vi.fn(async () => undefined),
  allowed: vi.fn(() => true),
})

describe('config backup cleanup', () => {
  it('only recognizes valid timestamped root printer backups', () => {
    expect(isPrinterConfigBackup(backup(1).path)).toBe(true)
    expect(isPrinterConfigBackup('printer-20240229_235959.cfg')).toBe(true)
    for (const path of [
      'printer.cfg',
      'printer_backup.cfg',
      'gcode_macro.cfg',
      '../' + backup(1).path,
      'folder/' + backup(1).path,
      '/' + backup(1).path,
      'printer-20260229_235959.cfg',
      'printer-20261301_000000.cfg',
      'printer-20261001_246000.cfg',
      'printer-20261001_194632.cfg.bak',
    ])
      expect(isPrinterConfigBackup(path)).toBe(false)
  })
  it('keeps only the newest timestamp irrespective of list order or modification time', () => {
    const plan = planConfigBackupCleanup(
      [...files]
        .reverse()
        .concat([files[0]!, { path: 'printer.cfg', size: 100, modified: 999 }]),
    )
    expect(plan.backups).toHaveLength(8)
    expect(plan.removable.map((f) => f.path)).toEqual(
      [7, 6, 5, 4, 3, 2, 1].map((n) => backup(n).path),
    )
    expect(planConfigBackupCleanup(files.slice(0, 1)).removable).toEqual([])
  })
  it('protects config includes, including wildcard classes, and ignores commented directives', async () => {
    const entries = [...files, { path: 'printer.cfg', size: 100, modified: 1 }]
    const protectedPaths = await referencedConfigBackups(
      entries,
      async () =>
        `[include ${backup(1).path}]\n# [include printer-*.cfg]\n[include macros/*.cfg]`,
    )
    expect([...protectedPaths]).toEqual([backup(1).path])
    expect(
      planConfigBackupCleanup(entries, protectedPaths).removable,
    ).toHaveLength(6)
    for (const include of [
      'printer-*.cfg',
      'printer-2026100?_194632.cfg',
      'printer-[0-9]*.cfg',
    ]) {
      expect(
        (
          await referencedConfigBackups(
            entries,
            async () => `[include ${include}]`,
          )
        ).size,
      ).toBe(8)
    }
  })
  it('resolves parent-relative includes from subdirectories and absolute references conservatively', async () => {
    const entries = [
      ...files,
      { path: 'macros/settings.cfg', size: 1, modified: 1 },
    ]
    expect(
      await referencedConfigBackups(
        entries,
        async () =>
          `[include ../${backup(1).path}]\n[include /mnt/config/${backup(2).path}]`,
      ),
    ).toEqual(new Set([backup(1).path, backup(2).path]))
  })
  it('revalidates approved names and metadata and never deletes active config or retained files', async () => {
    const d = deps()
    const approved = [
      backup(1),
      { ...backup(2), size: 999 },
      backup(8),
      { path: 'printer.cfg', size: 1, modified: 1 },
      backup(1),
    ]
    const result = await cleanConfigBackups(approved, d)
    expect(result.deleted).toEqual([backup(1).path])
    expect(result.skipped).toBe(3)
    expect(d.remove).toHaveBeenCalledTimes(1)
  })
  it('protects references discovered after confirmation', async () => {
    const d = deps()
    d.list.mockResolvedValue([
      ...files,
      { path: 'printer.cfg', size: 1, modified: 1 },
    ])
    d.read.mockResolvedValue(`[include ${backup(1).path}]`)
    expect((await cleanConfigBackups([backup(1)], d)).skipped).toBe(1)
    expect(d.remove).not.toHaveBeenCalled()
  })
  it('does not delete if config references cannot be checked', async () => {
    const d = deps()
    d.list.mockResolvedValue([
      ...files,
      { path: 'printer.cfg', size: 1, modified: 1 },
    ])
    d.read.mockRejectedValue(new Error('Read failed'))
    await expect(cleanConfigBackups([backup(1)], d)).rejects.toThrow(
      'Read failed',
    )
    expect(d.remove).not.toHaveBeenCalled()
  })
  it('stops between deletions when a print starts or connection is lost', async () => {
    const d = deps()
    let allowed = true
    d.allowed.mockImplementation(() => allowed)
    d.remove.mockImplementation(async () => {
      allowed = false
    })
    const result = await cleanConfigBackups([backup(1), backup(2)], d)
    expect(result.deleted).toEqual([backup(1).path])
    expect(result.stopped).toContain('busy or disconnected')
    expect(d.remove).toHaveBeenCalledTimes(1)
  })
  it('does nothing when initially blocked and reports partial failure accurately', async () => {
    const d = deps()
    d.allowed.mockReturnValue(false)
    expect((await cleanConfigBackups([backup(1)], d)).deleted).toEqual([])
    expect(d.list).not.toHaveBeenCalled()
    d.allowed.mockReturnValue(true)
    d.remove
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Delete failed'))
    const result = await cleanConfigBackups(
      [backup(1), backup(2), backup(3)],
      d,
    )
    expect(result.deleted).toEqual([backup(1).path])
    expect(result.stopped).toBe('Delete failed')
    expect(d.remove).toHaveBeenCalledTimes(2)
  })
})
