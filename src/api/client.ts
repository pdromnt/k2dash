import { getMoonrakerBaseUrl } from '@/utils/env'
import { isPreview, previewResponse } from '@/utils/preview'

const REQUEST_TIMEOUT_MS = 10000

async function fetchMoonraker(path: string, options: RequestInit, timeoutMs: number) {
  const response = await fetch(`${getMoonrakerBaseUrl()}${path}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  if (isPreview) {
    if (options.method && options.method !== 'GET')
      throw new Error('Printer actions are disabled in preview')
    return previewResponse(path) as T
  }
  const resp = await fetchMoonraker(path, options, timeoutMs)
  const contentType = resp.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return resp.json()
  }
  return resp.text() as unknown as T
}

export const api = {
  get<T>(path: string, options: { timeoutMs?: number; cache?: RequestCache } = {}) {
    return request<T>(path, { cache: options.cache }, options.timeoutMs)
  },
  post<T>(path: string, body?: unknown, timeoutMs?: number) {
    return request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, timeoutMs)
  },
  delete<T>(path: string) {
    return request<T>(path, { method: 'DELETE' })
  },
  /**
   * Multipart upload (used by the Klipper config editor to save files).
   * Bypasses the JSON encoding of `post` and lets the caller supply a FormData body.
   */
  async upload<T = unknown>(
    path: string,
    form: FormData,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (isPreview) throw new Error('Uploads are disabled in preview')
    const resp = await fetchMoonraker(path, { method: 'POST', body: form }, timeoutMs)
    return resp.json().catch(() => undefined) as T
  },
}
