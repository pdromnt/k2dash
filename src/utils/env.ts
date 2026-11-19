/**
 * Environment / connection helpers. Single source of truth for the printer
 * host and the various port numbers; previously duplicated across
 * api/client.ts, api/creality.ts, composables/usePrinterWs.ts and
 * composables/useWebcam.ts.
 */

export const HOST = import.meta.env.VITE_PRINTER_HOST || '127.0.0.1'
export const API_PORT = import.meta.env.VITE_API_PORT || '7125'
export const UPLOAD_PORT = import.meta.env.VITE_UPLOAD_PORT || '80'
export const WEBCAM_PORT = import.meta.env.VITE_WEBCAM_PORT || '8000'
export const WS_PORT = '9999'

const proxied = import.meta.env.DEV || import.meta.env.VITE_PRINTER_PROXY === 'true'

/**
 * Dev or proxy-enabled build: same-origin routes (also support HTTPS).
 * Default production build: direct LAN connections to the printer.
 */
export function getMoonrakerBaseUrl(): string {
  if (proxied) return '/api/moonraker'
  return `http://${HOST}:${API_PORT}`
}

export function getUploadBaseUrl(): string {
  if (proxied) return '/api/printer-upload'
  return `http://${HOST}:${UPLOAD_PORT}`
}

export function getWebcamBaseUrl(): string {
  if (proxied) return '/api/printer-camera'
  return `http://${HOST}:${WEBCAM_PORT}`
}

export function getWsUrl(): string {
  if (proxied) {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${scheme}//${window.location.host}/api/printer-ws`
  }
  return `ws://${HOST}:${WS_PORT}`
}
