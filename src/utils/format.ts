export function fmtDur(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

export function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

export function splitPath(p: string) {
  return p.split('/').pop() || p
}

export function replaceBasename(path: string, basename: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? `${path.slice(0, slash + 1)}${basename}` : basename
}

/**
 * Normalize a gcode filename to its path relative to the gcodes root.
 * The Creality K2 Plus WebSocket sometimes sends the absolute filesystem
 * path (/mnt/UDISK/printer_data/gcodes/foo.gcode) while the HTTP API
 * returns just foo.gcode. Strip everything up to and including /gcodes/
 * so both sources agree and downstream lookups (metadata, thumbnails)
 * don't 404 on the absolute path.
 */
export function normalizeGcodePath(raw: string): string {
  const idx = raw.lastIndexOf('/gcodes/')
  return idx >= 0 ? raw.slice(idx + '/gcodes/'.length) : raw
}

/** Convert filament length stored in mm to a human-readable meters string. */
export function fmtFilamentMeters(mm: number) {
  return `${(mm / 1000).toFixed(1)}m`
}

export function errMsg(e: unknown): string | undefined {
  return e instanceof Error ? e.message : undefined
}

// ---------------------------------------------------------------------------
// Printer error lookup. The K2 Plus pushes a numeric errcode on its
// WebSocket (port 9999) when the printer enters an error state. The
// translations live in printer-errors.json, extracted from the
// CrealityPrint webview bundle (CQKv4dak.js — same firmware family).
// ---------------------------------------------------------------------------

import errorMapJson from './printer-errors.json'

export interface PrinterErrorInfo {
  /** Short prefixed code, e.g. "FR5028" or "FO0528". May be null. */
  code: string | null
  /** 1 = error, 2 = warning. May be null if unknown. */
  level: 1 | 2 | null
  /** Human-readable English message. Falls back to null. */
  message: string | null
  /** Wiki URL for further troubleshooting, or null. */
  wiki: string | null
}

const errorMap = errorMapJson as Record<string, PrinterErrorInfo>

/**
 * Look up a printer error by its numeric code (as pushed on the
 * K2 Plus WebSocket). Returns null if unknown — caller should fall
 * back to showing the raw code.
 */
export function printerError(code: number | string): PrinterErrorInfo | null {
  const key = String(code)
  return errorMap[key] ?? null
}
