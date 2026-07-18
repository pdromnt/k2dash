import { api } from "./client";

interface PrinterObjectsQuery {
  eventtime: number;
  status: Record<string, Record<string, unknown>>;
}

export interface FileInfo {
  path: string;
  modified: number;
  size: number;
  permissions: string;
}

export interface HistoryJob {
  job_id: string;
  filename: string;
  status: string;
  start_time: number;
  end_time: number;
  total_duration: number;
  print_duration: number;
  filament_used: number;
}

interface HistoryList {
  count: number;
  jobs: HistoryJob[];
}

export async function queryPrinterObjects(
  objects: Record<string, string[] | null>,
): Promise<PrinterObjectsQuery> {
  const params = new URLSearchParams();
  for (const [key, fields] of Object.entries(objects)) {
    if (fields && fields.length > 0) {
      params.append(key, fields.join(","));
    } else {
      params.append(key, "");
    }
  }
  const data = await api.get<{ result: PrinterObjectsQuery }>(
    `/printer/objects/query?${params.toString()}`,
  );
  return data.result;
}

export async function emergencyStop(): Promise<string> {
  return api.post("/printer/emergency_stop");
}

export async function sendGcode(script: string): Promise<string> {
  return api.post("/printer/gcode/script", { script });
}

/**
 * Restart the Klipper host. Required after editing config files so the
 * changes take effect. May not be available on every firmware — the
 * K2 Plus's Creality fork supports it via the standard Moonraker path.
 */
export async function restartKlipper(): Promise<string> {
  return api.post("/printer/restart");
}

export async function getFileList(root = "gcodes"): Promise<FileInfo[]> {
  const data = await api.get<{ result: FileInfo[] }>(
    `/server/files/list?root=${root}`,
  );
  return data.result || [];
}

export async function deleteFile(filePath: string): Promise<string> {
  return api.delete(`/server/files/gcodes/${encodeURIComponent(filePath)}`);
}

export async function renameFile(sourcePath: string, destinationPath: string): Promise<unknown> {
  return api.post('/server/files/move', {
    source: `gcodes/${sourcePath.replace(/^\/+/, '')}`,
    dest: `gcodes/${destinationPath.replace(/^\/+/, '')}`,
  });
}

export async function startPrint(filename: string): Promise<string> {
  return api.post("/printer/print/start", { filename });
}

export async function pausePrint(): Promise<string> {
  return api.post("/printer/print/pause");
}

export async function resumePrint(): Promise<string> {
  return api.post("/printer/print/resume");
}

export async function cancelPrint(): Promise<string> {
  return api.post("/printer/print/cancel");
}

export async function getHistoryList(): Promise<HistoryList> {
  const data = await api.get<{ result: HistoryList }>("/server/history/list");
  return data.result;
}

export async function deleteHistoryJob(jobId: string): Promise<unknown> {
  return api.delete(`/server/history/job?uid=${encodeURIComponent(jobId)}`);
}

export async function clearHistory(): Promise<unknown> {
  return api.delete('/server/history/job?all=true');
}

export async function getConfigFiles(): Promise<FileInfo[]> {
  return getFileList('config')
}

export async function getConfigFile(filePath: string): Promise<string> {
  return api.get(`/server/files/config/${encodeURIComponent(filePath)}`);
}

export async function saveConfigFile(filePath: string, content: string): Promise<void> {
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
  return api.delete(`/server/files/config/${encodeURIComponent(filePath)}`);
}
