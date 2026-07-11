import { ref, watch } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import type { CfsSlot, TimelapseFile, PrinterState } from '@/stores/printer'
import { getWsUrl } from '@/utils/env'
import { normalizeGcodePath } from '@/utils/format'

type WsSubscriber = (msg: Record<string, unknown>) => void

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
const STATUS_POLL_MS = 5000
const CFS_POLL_MS = 20000
const LAYER_DIVIDER = 3 // Creality WS reports layer at 3x the actual count

// Creality WS device state → Klipper-style state name
const DEVICE_STATE_MAP: Record<number, string> = {
  0: 'idle', 1: 'printing', 2: 'paused', 3: 'complete', 4: 'preparing', 5: 'error',
}

// ── Module-level state ────────────────────────────────────
// The socket, connection state, pub/sub, and reconnect timers live at
// module scope so every usePrinterWs() caller sees the same instance.
// Without this, useConsole and AppLayout would each get a fresh
// usePrinterWs() with their own disconnected subscribers/connected ref.
let ws: WebSocket | null = null
const connected = ref(false)
const subscribers = new Set<WsSubscriber>()
let boxsTimer: ReturnType<typeof setInterval> | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null
let retryCount = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

// File list is internal state used to enrich print data (filament estimates).
// It's reactive so we can re-attempt matching when either the file list
// or printFilename changes.
const fileList = ref<Array<Record<string, unknown>>>([])

function backoff(): number {
  return Math.min(INITIAL_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS)
}

function send(msg: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function stopTimers() {
  if (boxsTimer) { clearInterval(boxsTimer); boxsTimer = null }
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null }
}

function scheduleRetry() {
  if (retryTimer) return
  retryCount++
  const delay = backoff()
  retryTimer = setTimeout(() => {
    retryTimer = null
    connect()
  }, delay)
}

function parseAndDispatch(msg: Record<string, unknown>) {
  if (msg.nozzleTemp !== undefined || msg.deviceState !== undefined) {
    parseStatus(msg)
  }
  if (msg.boxsInfo) parseBoxsInfo(msg.boxsInfo as Record<string, unknown>)
  if (msg.retGcodeFileInfo2) parseFileList(msg.retGcodeFileInfo2)
  if (msg.elapseVideoList) parseTimelapseList(msg.elapseVideoList)
  for (const sub of subscribers) sub(msg)
}

function connect() {
  if (!import.meta.env.VITE_PRINTER_HOST) return
  // Idempotent: only one socket at a time.
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const store = usePrinterStore()

  try {
    const socket = new WebSocket(getWsUrl())
    ws = socket
    window.__printerWs = socket

    socket.addEventListener('open', () => {
      connected.value = true
      store.connected = true
      retryCount = 0
      store.wsActive = true

      // Full initial state request (like CrealityPrint's ReqInit)
      send({
        method: 'get',
        params: {
          reqGcodeFile: 1,
          reqGcodeList: 1,
          reqMaterials: 1,
          boxsInfo: 1,
          boxConfig: 1,
        },
      })

      statusTimer = setInterval(() => {
        send({ method: 'get', params: { reqPrintObjects: 1, reqGcodeFile: 1 } })
      }, STATUS_POLL_MS)

      boxsTimer = setInterval(() => {
        send({ method: 'get', params: { boxsInfo: 1 } })
      }, CFS_POLL_MS)
    })

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data)
        parseAndDispatch(msg)
      } catch { /* ignore */ }
    })

    socket.addEventListener('close', () => {
      connected.value = false
      store.connected = false
      store.wsActive = false
      stopTimers()
      scheduleRetry()
    })

    socket.addEventListener('error', () => {
      connected.value = false
      store.connected = false
      store.wsActive = false
      stopTimers()
      socket.close()
      scheduleRetry()
    })
  } catch {
    connected.value = false
    scheduleRetry()
  }
}

function parseStatus(msg: Record<string, unknown>) {
  const store = usePrinterStore()
  const n = (v: unknown): number | undefined => {
    if (typeof v === 'number') return v
    if (typeof v === 'string') { const p = parseFloat(v); return isNaN(p) ? undefined : p }
    return undefined
  }

  if (typeof msg.deviceState === 'number') {
    store.state = (DEVICE_STATE_MAP[msg.deviceState] || 'unknown') as PrinterState
    if (msg.deviceState === 0) clearPrintJob()
  } else if (typeof msg.deviceState === 'string') {
    store.state = msg.deviceState as PrinterState
    if (msg.deviceState === 'idle') clearPrintJob()
  } else if (typeof msg.state === 'string') {
    store.state = msg.state as PrinterState
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
    const code = Number(e.errcode ?? e.key ?? 0)
    store.errorCode = code
    store.errorMessage = typeof e.value === 'string' ? e.value : ''
    if (code !== 0 && code !== store.dismissedErrorCode) {
      store.dismissedErrorCode = 0
    }
  }

  const et = n(msg.nozzleTemp); if (et !== undefined) store.extruderTemp = et
  const ett = n(msg.targetNozzleTemp); if (ett !== undefined) store.extruderTarget = ett
  const bt = n(msg.bedTemp0); if (bt !== undefined) store.bedTemp = bt
  const btt = n(msg.targetBedTemp0); if (btt !== undefined) store.bedTarget = btt
  const ct = n(msg.boxTemp); if (ct !== undefined) store.chamberTemp = ct
  const ctt = n(msg.targetBoxTemp); if (ctt !== undefined) store.chamberTarget = ctt

  const pp = n(msg.printProgress)
  if (pp !== undefined) store.printProgress = pp <= 1 ? Math.round(pp * 100) : Math.round(pp)
  if (typeof msg.printFileName === 'string') store.printFilename = normalizeGcodePath(msg.printFileName)
  const pjt = n(msg.printJobTime); if (pjt !== undefined) store.printDuration = pjt
  const plt = n(msg.printLeftTime); if (plt !== undefined) store.printLeftTime = plt
  const l = n(msg.layer); if (l !== undefined) store.currentLayer = Math.round(l / LAYER_DIVIDER)
  const tl = n(msg.TotalLayer); if (tl !== undefined) store.totalLayers = tl
  const fu = n(msg.usedMaterialLength); if (fu !== undefined) store.filamentUsed = fu

  const mfp = n(msg.modelFanPct); if (mfp !== undefined) store.fanPart = mfp / 100
  const cfp = n(msg.auxiliaryFanPct); if (cfp !== undefined) store.fanChamber = cfp / 100
  const afp = n(msg.caseFanPct); if (afp !== undefined) store.fanAux = afp / 100

  const ls = n(msg.lightSw)
  if (ls !== undefined) store.ledState = ls > 0

  if (msg.curPosition) {
    let pos: { x: number; y: number; z: number } | null = null
    if (typeof msg.curPosition === 'string') {
      const m = (msg.curPosition as string).match(/X:([-\d.]+)\s*Y:([-\d.]+)\s*Z:([-\d.]+)/)
      if (m) pos = { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) }
      else {
        try { const a = JSON.parse(msg.curPosition); if (Array.isArray(a) && a.length >= 3) pos = { x: n(a[0]) ?? 0, y: n(a[1]) ?? 0, z: n(a[2]) ?? 0 } } catch { /* ignore */ }
      }
    } else if (Array.isArray(msg.curPosition)) {
      const a = msg.curPosition as number[]
      if (a.length >= 3) pos = { x: n(a[0]) ?? 0, y: n(a[1]) ?? 0, z: n(a[2]) ?? 0 }
    }
    if (pos) store.position = pos
  }
}

function clearPrintJob() {
  const store = usePrinterStore()
  store.printFilename = ''
  store.printProgress = 0
  store.currentLayer = 0
  store.totalLayers = 0
  store.thumbnailUrl = ''
  store.errorCode = 0
  store.errorMessage = ''
}

function parseBoxsInfo(info: Record<string, unknown>) {
  const store = usePrinterStore()
  store.cfsName = (typeof info.name === 'string' ? info.name : '') || store.cfsName

  const boxs = info.materialBoxs as Array<Record<string, unknown>> | undefined
  if (!boxs) return

  // First non-spool CFS box wins for humidity/temperature
  let humidity: number | null = null
  let temp: number | null = null
  for (const box of boxs) {
    if (box.type === 0 && typeof box.humidity === 'number') humidity = box.humidity
    if (box.type === 0 && typeof box.temp === 'number') temp = box.temp
    if (humidity !== null && temp !== null) break
  }
  if (humidity !== null) store.cfsHumidity = humidity
  if (temp !== null) store.cfsTemp = temp

  const slots: CfsSlot[] = []
  for (const box of boxs) {
    const boxId = typeof box.id === 'number' ? box.id : 0
    const boxType = typeof box.type === 'number' ? box.type : 0
    const materials = box.materials as Array<Record<string, unknown>> | undefined
    if (!materials) continue

    for (const mat of materials) {
      const color = typeof mat.color === 'string' ? mat.color : ''
      slots.push({
        boxId,
        materialId: typeof mat.id === 'number' ? mat.id : 0,
        type: typeof mat.type === 'string' ? mat.type : '',
        color: color.startsWith('#') ? color : ('#' + color),
        name: typeof mat.name === 'string' ? mat.name : '',
        vendor: typeof mat.vendor === 'string' ? mat.vendor : '',
        percent: typeof mat.percent === 'number' ? mat.percent : 0,
        minTemp: typeof mat.minTemp === 'number' ? mat.minTemp : 0,
        maxTemp: typeof mat.maxTemp === 'number' ? mat.maxTemp : 0,
        state: typeof mat.state === 'number' ? mat.state : 0,
        isSpool: boxType === 1,
      })
    }
  }
  store.cfsSlots = slots
}

function parseFileList(info: unknown) {
  const files = Array.isArray(info) ? info as Array<Record<string, unknown>> : undefined
  if (!files?.length) return

  fileList.value = files
  matchEstimatedData(files)
}

function parseTimelapseList(info: unknown) {
  const store = usePrinterStore()
  const list = Array.isArray(info) ? info as Array<Record<string, unknown>> : undefined
  if (!list) return
  const files: TimelapseFile[] = []
  for (const f of list) {
    const name = typeof f.name === 'string' ? f.name : ''
    const video = typeof f.video === 'string' && f.video
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
  store.timelapseFiles = files
}

function matchEstimatedData(files: Array<Record<string, unknown>>) {
  const store = usePrinterStore()
  if (!store.printFilename || !files.length) return
  for (const f of files) {
    const name = typeof f.name === 'string' ? f.name : ''
    if (name === store.printFilename || store.printFilename.endsWith(name) || name.endsWith(store.printFilename)) {
      if (typeof f.materialUsed === 'string') store.filamentEstimated = parseFloat(f.materialUsed)
      if (typeof f.filamentWeight === 'string') {
        const weights = f.filamentWeight.split(',').map(w => parseFloat(w.trim())).filter(w => !isNaN(w))
        const total = weights.reduce((a, b) => a + b, 0)
        if (total > 0) store.filamentEstimatedWeight = total
      }
      break
    }
  }
}

export function usePrinterWs() {
  const store = usePrinterStore()

  // When printFilename changes, try to match against the cached file list
  watch(() => store.printFilename, (name) => {
    if (name && fileList.value.length) matchEstimatedData(fileList.value)
  })

  // Manual refresh of the timelapse list. The printer doesn't push
  // timelapse changes over the WS (CrealityPrint triggers this from
  // the UI on demand), so we only fetch on user action.
  function refreshTimelapses() {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ method: 'get', params: { reqElapseVideoList: 1 } }))
    }
  }

  return { connected, connect, onMessage, refreshTimelapses }
}

/**
 * Subscribe to every parsed WS message. Returns an unsubscribe function.
 * Used by useConsole to receive G-code responses without registering a
 * second handler on window.__printerWs.
 */
function onMessage(fn: WsSubscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
