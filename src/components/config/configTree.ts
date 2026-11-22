export interface ConfigTreeEntry {
  name: string
  path: string
  size?: number
  isDir: boolean
  children?: ConfigTreeEntry[]
}

export function buildConfigTree(
  rawFiles: Array<{ path: string; size: number; modified: number }>,
): ConfigTreeEntry[] {
  const root: ConfigTreeEntry[] = []
  for (const f of rawFiles) {
    const parts = f.path.split('/')
    let level = root
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1
      const name = parts[i]
      let existing = level.find((e) => e.name === name && e.isDir === !isLast)
      if (!existing) {
        existing = {
          name,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          size: isLast ? f.size : undefined,
          children: isLast ? undefined : [],
        }
        level.push(existing)
        level.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
      if (!isLast && existing.children) level = existing.children
    }
  }
  return root
}
