import type { usePrinterStore, PrinterState } from '@/stores/printer'
import { normalizeGcodePath } from '@/utils/format'
import { normalizeCrealityLayer, normalizeCrealityProgress } from './crealityProtocol'

type PrinterStore = ReturnType<typeof usePrinterStore>

// Creality WS device state → Klipper-style state name
const DEVICE_STATE_MAP: Record<number, PrinterState> = {
  0: 'idle',
  1: 'printing',
  2: 'paused',
  3: 'complete',
  4: 'preparing',
  5: 'error',
}

const n = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const p = parseFloat(v)
    return Number.isFinite(p) ? p : undefined
  }
  return undefined
}

function resetIdleJob(store: PrinterStore) {
  store.clearPrintJob()
  store.errorCode = 0
  store.errorMessage = ''
}

function readPosition(raw: unknown) {
  let pos: { x: number; y: number; z: number } | null = null
  if (typeof raw === 'string') {
    const m = raw.match(
      /X:([-\d.]+)\s*Y:([-\d.]+)\s*Z:([-\d.]+)/,
    )
    if (m)
      pos = { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) }
    else {
      try {
        const a = JSON.parse(raw)
        if (Array.isArray(a) && a.length >= 3)
          pos = { x: n(a[0]) ?? 0, y: n(a[1]) ?? 0, z: n(a[2]) ?? 0 }
      } catch {
        /* ignore */
      }
    }
  } else if (Array.isArray(raw)) {
    const a = raw as number[]
    if (a.length >= 3)
      pos = { x: n(a[0]) ?? 0, y: n(a[1]) ?? 0, z: n(a[2]) ?? 0 }
  }
  return pos
}

export function applyCrealityTelemetry(store: PrinterStore, msg: Record<string, unknown>) {
  if (typeof msg.model === 'string' && msg.model.trim()) {
    store.modelId = msg.model.trim().toUpperCase()
  }
  let cfsTopologyChanged = false
  if (
    msg.cfsConnect === 0 ||
    msg.cfsConnect === 1 ||
    typeof msg.cfsConnect === 'boolean'
  ) {
    const connected = msg.cfsConnect === 1 || msg.cfsConnect === true
    cfsTopologyChanged = store.cfsConnected !== connected
    store.cfsConnected = connected
    if (!connected) store.cfsUnits = []
  }
  const wasActive = store.jobActive
  let nativeStateSeen: boolean | undefined
  if (typeof msg.deviceState === 'number') {
    nativeStateSeen = true
    store.state = DEVICE_STATE_MAP[msg.deviceState] ?? 'unknown'
    if (msg.deviceState === 0) resetIdleJob(store)
  } else if (typeof msg.deviceState === 'string') {
    nativeStateSeen = true
    store.state = msg.deviceState as PrinterState
    if (msg.deviceState === 'idle') resetIdleJob(store)
  } else if (typeof msg.state === 'string') {
    nativeStateSeen = true
    store.state = msg.state as PrinterState
  } else if (Object.hasOwn(msg, 'deviceState')) {
    nativeStateSeen = false
  }

  // Error info: K2 Plus pushes a nested `err` object when the printer
  // is in an error state. The native firmware uses {errcode, value};
  // CrealityPrint's webview-shaped relay uses {key, value}. Handle
  // both. The K2 Plus's WS does NOT include the `err` field in every
  // status frame, so we must NOT clear the stored error on frames
  // that don't carry it — only on a brand-new code. The error stays
  // visible until the user dismisses it (or a NEW error arrives and
  // resets the dismiss flag).
  if (msg.err && typeof msg.err === 'object') {
    const e = msg.err as Record<string, unknown>
    // The K2 Plus firmware's `err` payload carries both:
    //   - `errcode`: a generic exception class (e.g. 500 = "Unknown
    //     exception") — too coarse to be useful on its own
    //   - `key`:     the actual error code that maps to a real
    //     message (e.g. 528 = FO0528 "printing without extruding")
    //   - `value`:   optional extra context (often empty)
    // Prefer `key` for display, fall back to `errcode` if missing.
    // Matches CrealityPrint's ErrorTip component, which reads g.err.key.
    const code = Number(e.key ?? e.errcode ?? 0)
    store.errorCode = code
    store.errorMessage = typeof e.value === 'string' ? e.value : ''
    if (code !== 0 && code !== store.dismissedErrorCode) {
      store.dismissedErrorCode = 0
    }
  }

  const et = n(msg.nozzleTemp)
  if (et !== undefined) store.extruderTemp = et
  const ett = n(msg.targetNozzleTemp)
  if (ett !== undefined) store.extruderTarget = ett
  const bt = n(msg.bedTemp0)
  if (bt !== undefined) store.bedTemp = bt
  const btt = n(msg.targetBedTemp0)
  if (btt !== undefined) store.bedTarget = btt
  const ct = n(msg.boxTemp)
  if (ct !== undefined) store.chamberTemp = ct
  const ctt = n(msg.targetBoxTemp)
  if (ctt !== undefined) store.chamberTarget = ctt

  const pp = n(msg.printProgress)
  // Creality's WS reports percentage points directly (1 means 1%, not
  // 100%). Match CrealityPrint and only clamp malformed firmware values.
  if (pp !== undefined) store.printProgress = normalizeCrealityProgress(pp)
  let filenameChanged = false
  if (typeof msg.printFileName === 'string') {
    const filename = normalizeGcodePath(msg.printFileName)
    if (filename !== store.printFilename) {
      if (store.printFilename) store.filamentUsed = null
      store.printFilename = filename
      filenameChanged = true
    }
  }
  const pjt = n(msg.printJobTime)
  if (pjt !== undefined) store.printDuration = pjt
  const plt = n(msg.printLeftTime)
  if (plt !== undefined) store.printLeftTime = plt
  // CrealityPrint displays both layer counters exactly as received. The old
  // divide-by-three workaround turned layer 1 into 0, which the UI rendered
  // as a dash, and caused later updates to lag behind the printer.
  const l = n(msg.layer)
  if (l !== undefined) store.currentLayer = normalizeCrealityLayer(l)
  const tl = n(msg.TotalLayer)
  if (tl !== undefined) store.totalLayers = normalizeCrealityLayer(tl)
  const fu = n(msg.usedMaterialLength)
  if (store.jobActive && fu !== undefined && fu >= 0) store.filamentUsed = fu

  const mfp = n(msg.modelFanPct)
  if (mfp !== undefined) store.fanPart = mfp / 100
  const cfp = n(msg.auxiliaryFanPct)
  if (cfp !== undefined) store.fanSide = cfp / 100
  const afp = n(msg.caseFanPct)
  if (afp !== undefined) store.fanCase = afp / 100

  const ls = n(msg.lightSw)
  if (ls !== undefined) store.ledState = ls > 0

  const pos = readPosition(msg.curPosition)
  if (pos) store.position = pos
  return { nativeStateSeen, cfsTopologyChanged, becameActive: !wasActive && store.jobActive, filenameChanged }
}
