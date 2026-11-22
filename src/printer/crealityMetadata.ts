import type { TimelapseFile, usePrinterStore } from '@/stores/printer'
import { normalizeGcodePath } from '@/utils/format'

export function parseTimelapseList(info: unknown): TimelapseFile[] | undefined {
  const list = Array.isArray(info)
    ? (info as Array<Record<string, unknown>>)
    : undefined
  if (!list) return
  const files: TimelapseFile[] = []
  for (const f of list) {
    if (!f || typeof f !== 'object') continue
    const name = typeof f.name === 'string' ? f.name : ''
    const video =
      typeof f.video === 'string' && f.video
        ? f.video
        : name.split('/').pop() || name
    if (!video) continue
    files.push({
      name,
      video,
      size: typeof f.size === 'number' ? f.size : 0,
      starttime: typeof f.starttime === 'number' ? f.starttime : 0,
      duration: typeof f.duration === 'number' ? f.duration : 0,
      videoname: typeof f.videoname === 'string' ? f.videoname : undefined,
    })
  }
  return files
}

function sumFilamentMetadata(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0
  if (typeof value !== 'string') return 0
  const parts = value.split(',').map((part) => part.trim() ? Number(part) : NaN)
  const total = parts.reduce((sum, part) => sum + part, 0)
  return Number.isFinite(total) && parts.every((part) => part >= 0) ? total : 0
}

export function findNativeFile(files: Array<Record<string, unknown>>, path: string) {
  return files.find((file) => normalizeGcodePath(String(file.path || file.name || '')) === path)
}

export function applyJobFilamentEstimate(store: ReturnType<typeof usePrinterStore>, files: Array<Record<string, unknown>>) {
  const file = store.printFilename ? findNativeFile(files, store.printFilename) : undefined
  store.filamentEstimated = sumFilamentMetadata(file?.materialUsed)
  store.filamentEstimatedWeight = sumFilamentMetadata(file?.filamentWeight)
}
