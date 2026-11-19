import { api } from './client'

export interface FileInfo {
  path: string
  modified: number
  size: number
  permissions: string
}

export interface HistoryJob {
  job_id: string
  filename: string
  status: string
  start_time: number
  end_time: number
  total_duration: number
  print_duration: number
  filament_used: number
}

interface HistoryList {
  count: number
  jobs: HistoryJob[]
}

/** Restart the host to reload config, or also reset its MCUs for recovery. */
export async function restartKlipper(kind: 'host' | 'firmware'): Promise<void> {
  // The installed Moonraker may wait up to 20s for Klippy before issuing it.
  const response = await api.post<{ result?: string }>(
    kind === 'firmware' ? '/printer/firmware_restart' : '/printer/restart',
    undefined,
    35_000,
  )
  if (response?.result !== 'ok') throw new Error('Moonraker did not acknowledge the restart.')
}

export async function getKlipperState(timeoutMs: number): Promise<string | undefined> {
  const { result } = await api.get<{ result?: { state?: string } }>('/printer/info', {
    timeoutMs,
    cache: 'no-store',
  })
  return result?.state
}

export async function getFileList(root = 'gcodes'): Promise<FileInfo[]> {
  const data = await api.get<{ result: FileInfo[] }>(
    `/server/files/list?root=${root}`,
  )
  return data.result || []
}

export async function deleteFile(filePath: string): Promise<string> {
  return api.delete(`/server/files/gcodes/${encodeURIComponent(filePath)}`)
}

export async function renameFile(
  sourcePath: string,
  destinationPath: string,
): Promise<unknown> {
  return api.post('/server/files/move', {
    source: `gcodes/${sourcePath.replace(/^\/+/, '')}`,
    dest: `gcodes/${destinationPath.replace(/^\/+/, '')}`,
  })
}

export async function getHistoryList(): Promise<HistoryList> {
  const data = await api.get<{ result: HistoryList }>('/server/history/list')
  return data.result
}

export async function deleteHistoryJob(jobId: string): Promise<unknown> {
  return api.delete(`/server/history/job?uid=${encodeURIComponent(jobId)}`)
}

export async function clearHistory(): Promise<unknown> {
  return api.delete('/server/history/job?all=true')
}

export async function getConfigFiles(): Promise<FileInfo[]> {
  return getFileList('config')
}

export async function getConfigFile(filePath: string): Promise<string> {
  return api.get(`/server/files/config/${encodeURIComponent(filePath)}`)
}

export async function saveConfigFile(
  filePath: string,
  content: string,
): Promise<void> {
  // Moonraker's _parse_upload_args joins `path` (a directory) with the
  // filename into the final destination, and _process_uploaded_file
  // then mkdir's every segment of `path`. If path == filename (or any
  // segment equals the filename) it tries to mkdir an existing file
  // and crashes with NotADirectoryError → 500. So the rule is:
  //   - filename  = basename only
  //   - path      = subdirectory only, omitted when at the root
  // Also strip a leading slash so we never send `path=/gcode_macro.cfg`.
  const cleanPath = filePath.replace(/^\/+/, '')
  const lastSlash = cleanPath.lastIndexOf('/')
  const dir = lastSlash >= 0 ? cleanPath.slice(0, lastSlash) : ''
  const filename = lastSlash >= 0 ? cleanPath.slice(lastSlash + 1) : cleanPath

  if (!filename) {
    throw new Error('Invalid config file path')
  }

  const form = new FormData()
  form.append('file', new Blob([content], { type: 'text/plain' }), filename)
  form.append('root', 'config')
  if (dir) form.append('path', dir)
  await api.upload('/server/files/upload', form, 15000)
}

export async function deleteConfigFile(filePath: string): Promise<string> {
  return api.delete(`/server/files/config/${encodeURIComponent(filePath)}`)
}
