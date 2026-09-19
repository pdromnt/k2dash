import type { HistoryJob } from '@/api/moonraker'
import { splitPath } from '@/utils/format'

export function findActiveHistoryJobId(
  jobs: HistoryJob[],
  printerFilename: string,
  printerActive: boolean,
): string | null {
  if (!printerActive || !printerFilename) return null
  const filename = splitPath(printerFilename)
  const matching = jobs.filter((job) =>
    job.status === 'in_progress' && splitPath(job.filename) === filename,
  )
  if (!matching.length) return null
  return matching.reduce((latest, job) => job.start_time > latest.start_time ? job : latest).job_id
}
