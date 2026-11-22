export interface ConfigFileEntry {
  path: string
  size: number
  modified: number
}

export const CONFIG_BACKUPS_TO_KEEP = 1

export function isPrinterConfigBackup(path: string): boolean {
  const match =
    /^printer-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.cfg$/.exec(path)
  if (!match) return false
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day, hour, minute, second))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  )
}

export function planConfigBackupCleanup(
  files: readonly ConfigFileEntry[],
  protectedPaths = new Set<string>(),
) {
  const backups = [
    ...new Map(
      files
        .filter((f) => isPrinterConfigBackup(f.path))
        .map((f) => [f.path, f]),
    ).values(),
  ].sort((a, b) => b.path.localeCompare(a.path))
  return {
    backups,
    removable: backups
      .slice(CONFIG_BACKUPS_TO_KEEP)
      .filter((f) => !protectedPaths.has(f.path)),
  }
}

// Inspect include directives in non-backup configs, not arbitrary text or
// comments. A wildcard character class is handled conservatively: protect all
// root backups rather than risk implementing different glob semantics.
export async function referencedConfigBackups(
  files: readonly ConfigFileEntry[],
  read: (path: string) => Promise<string>,
) {
  const protectedPaths = new Set<string>()
  const backups = files.filter((f) => isPrinterConfigBackup(f.path))
  for (const file of files.filter(
    (f) => f.path.endsWith('.cfg') && !isPrinterConfigBackup(f.path),
  )) {
    const text = await read(file.path)
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*\[include\s+(.+)\]\s*$/.exec(line.split(/[#;]/, 1)[0]!)
      if (!match) continue
      const include = match[1]!.trim()
      const parts: string[] = []
      for (const part of `${file.path.slice(0, file.path.lastIndexOf('/') + 1)}${include}`.split(
        '/',
      )) {
        if (part === '..') parts.pop()
        else if (part && part !== '.') parts.push(part)
      }
      const resolved = parts.join('/')
      if (resolved.includes('/') && !include.startsWith('/')) continue
      const pattern = include.startsWith('/')
        ? include.split('/').at(-1)!
        : resolved
      if (pattern.includes('[')) {
        backups.forEach((f) => protectedPaths.add(f.path))
        continue
      }
      const regex = new RegExp(
        '^' +
          pattern
            .replace(/[.+^${}()|\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.') +
          '$',
      )
      backups
        .filter((f) => regex.test(f.path))
        .forEach((f) => protectedPaths.add(f.path))
    }
  }
  return protectedPaths
}

interface CleanupDependencies {
  list: () => Promise<ConfigFileEntry[]>
  read: (path: string) => Promise<string>
  remove: (path: string) => Promise<unknown>
  allowed: () => boolean
  progress?: (deleted: number) => void
}

export async function cleanConfigBackups(
  approved: readonly ConfigFileEntry[],
  deps: CleanupDependencies,
) {
  const deleted: string[] = []
  let skipped = 0
  if (!deps.allowed())
    return { deleted, skipped, stopped: 'Printer is busy or disconnected.' }
  const current = await deps.list()
  const protectedPaths = await referencedConfigBackups(current, deps.read)
  const eligible = new Map(
    planConfigBackupCleanup(current, protectedPaths).removable.map((f) => [
      f.path,
      f,
    ]),
  )
  for (const file of [...new Map(approved.map((f) => [f.path, f])).values()]) {
    if (!deps.allowed())
      return {
        deleted,
        skipped,
        stopped: 'Printer became busy or disconnected. Cleanup stopped.',
      }
    const fresh = eligible.get(file.path)
    if (
      !fresh ||
      fresh.size !== file.size ||
      fresh.modified !== file.modified
    ) {
      skipped++
      continue
    }
    try {
      await deps.remove(file.path)
    } catch (error) {
      return {
        deleted,
        skipped,
        stopped:
          error instanceof Error
            ? error.message
            : 'A backup could not be deleted.',
      }
    }
    deleted.push(file.path)
    deps.progress?.(deleted.length)
  }
  return { deleted, skipped, stopped: '' }
}
