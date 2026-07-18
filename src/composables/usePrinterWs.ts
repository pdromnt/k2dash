import { ref } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import type { CfsSlot, TimelapseFile, PrinterState } from '@/stores/printer'
import { getWsUrl } from '@/utils/env'
import { normalizeGcodePath } from '@/utils/format'
import {
  cancelPrint as cancelPrintMoonraker,
  emergencyStop as emergencyStopMoonraker,
  pausePrint as pausePrintMoonraker,
  resumePrint as resumePrintMoonraker,
  sendGcode as sendGcodeMoonraker,
  startPrint as startPrintMoonraker,
} from '@/api/moonraker'
import {
  cancelCommand,
  deleteTimelapseCommand,
  gcodeCommand,
  hasTimelapseDeleteResult,
  hasTimelapseList,
  initialStateRequest,
  normalizeCrealityLayer,
  normalizeCrealityProgress,
  pauseCommand,
  resumeCommand,
  startPrintCommand,
  statusRequest,
  timelapseListRequest,
  type CrealityMessage,
} from '@/printer/crealityProtocol'

type WsSubscriber = (msg: Record<string, unknown>) => void
type MessagePredicate = (msg: Record<string, unknown>) => boolean
type CommandTransport = 'websocket' | 'moonraker'

interface PendingResponse {
  predicate: MessagePredicate
  resolve: (msg: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
const STATUS_POLL_MS = 5000
const CFS_POLL_MS = 20000

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
const pendingResponses = new Set<PendingResponse>()
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

function send(msg: CrealityMessage): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(msg))
    return true
  } catch {
    return false
  }
}

function rejectPendingResponses(error: Error) {
  for (const pending of pendingResponses) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  pendingResponses.clear()
}

function requestMessage(
  msg: CrealityMessage,
  predicate: MessagePredicate,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pending: PendingResponse = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        pendingResponses.delete(pending)
        reject(new Error('Printer response timed out'))
      }, timeoutMs),
    }
    pendingResponses.add(pending)
    if (!send(msg)) {
      clearTimeout(pending.timer)
      pendingResponses.delete(pending)
      reject(new Error('Printer WebSocket not connected'))
    }
  })
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
  // Creality sends partial updates: the print-state transition and the
  // current filename commonly arrive in different frames. CrealityPrint's
  // setDataFromDevice applies every property independently, so do the same
  // here. parseStatus itself only changes fields that are present.
  parseStatus(msg)
  if (msg.boxsInfo) parseBoxsInfo(msg.boxsInfo as Record<string, unknown>)
  if (msg.retGcodeFileInfo2) parseFileList(msg.retGcodeFileInfo2)
  if (msg.elapseVideoList) parseTimelapseList(msg.elapseVideoList)
  for (const pending of [...pendingResponses]) {
    if (!pending.predicate(msg)) continue
    clearTimeout(pending.timer)
    pendingResponses.delete(pending)
    pending.resolve(msg)
  }
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

    socket.addEventListener('open', () => {
      connected.value = true
      store.connected = true
      retryCount = 0
      store.wsActive = true

      // Full initial state request (like CrealityPrint's ReqInit)
      send(initialStateRequest())
      send(statusRequest())

      statusTimer = setInterval(() => {
        send(statusRequest())
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
      if (ws !== socket) return
      ws = null
      connected.value = false
      store.connected = false
      store.wsActive = false
      stopTimers()
      rejectPendingResponses(new Error('Printer WebSocket disconnected'))
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
  const wasActive = store.state === 'printing' || store.state === 'preparing' || store.state === 'paused'
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

  const isActive = store.state === 'printing' || store.state === 'preparing' || store.state === 'paused'
  if (!wasActive && isActive) {
    // A state push often precedes printFileName. Ask for the current file
    // immediately instead of waiting for the five-second status timer.
    send(statusRequest())
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

  const et = n(msg.nozzleTemp); if (et !== undefined) store.extruderTemp = et
  const ett = n(msg.targetNozzleTemp); if (ett !== undefined) store.extruderTarget = ett
  const bt = n(msg.bedTemp0); if (bt !== undefined) store.bedTemp = bt
  const btt = n(msg.targetBedTemp0); if (btt !== undefined) store.bedTarget = btt
  const ct = n(msg.boxTemp); if (ct !== undefined) store.chamberTemp = ct
  const ctt = n(msg.targetBoxTemp); if (ctt !== undefined) store.chamberTarget = ctt

  const pp = n(msg.printProgress)
  // Creality's WS reports percentage points directly (1 means 1%, not
  // 100%). Match CrealityPrint and only clamp malformed firmware values.
  if (pp !== undefined) store.printProgress = normalizeCrealityProgress(pp)
  if (typeof msg.printFileName === 'string') {
    store.printFilename = normalizeGcodePath(msg.printFileName)
    if (store.printFilename && fileList.value.length) matchEstimatedData(fileList.value)
  }
  const pjt = n(msg.printJobTime); if (pjt !== undefined) store.printDuration = pjt
  const plt = n(msg.printLeftTime); if (plt !== undefined) store.printLeftTime = plt
  // CrealityPrint displays both layer counters exactly as received. The old
  // divide-by-three workaround turned layer 1 into 0, which the UI rendered
  // as a dash, and caused later updates to lag behind the printer.
  const l = n(msg.layer); if (l !== undefined) store.currentLayer = normalizeCrealityLayer(l)
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

  async function withMoonrakerFallback(
    message: CrealityMessage,
    fallback: () => Promise<unknown>,
  ): Promise<CommandTransport> {
    if (send(message)) return 'websocket'
    await fallback()
    return 'moonraker'
  }

  function sendGcodeCommand(command: string): Promise<CommandTransport> {
    return withMoonrakerFallback(gcodeCommand(command), () => sendGcodeMoonraker(command))
  }

  function pausePrint(): Promise<CommandTransport> {
    return withMoonrakerFallback(pauseCommand(), pausePrintMoonraker)
  }

  function resumePrint(): Promise<CommandTransport> {
    return withMoonrakerFallback(resumeCommand(), resumePrintMoonraker)
  }

  function cancelPrint(): Promise<CommandTransport> {
    return withMoonrakerFallback(cancelCommand(), cancelPrintMoonraker)
  }

  function emergencyStop(): Promise<CommandTransport> {
    return withMoonrakerFallback(gcodeCommand('M112'), emergencyStopMoonraker)
  }

  function startPrint(path: string): Promise<CommandTransport> {
    return withMoonrakerFallback(startPrintCommand(path), () => startPrintMoonraker(path))
  }

  async function refreshTimelapses() {
    await requestMessage(timelapseListRequest(), hasTimelapseList)
    return store.timelapseFiles
  }

  async function deleteTimelapse(file: string) {
    // Recent firmware acknowledges ctrlVideoFiles. Older versions do not,
    // so an acknowledgement timeout is non-fatal; the refreshed list is
    // the source of truth either way.
    await requestMessage(deleteTimelapseCommand(file), hasTimelapseDeleteResult, 2500).catch(() => undefined)
    await refreshTimelapses()
    if (store.timelapseFiles.some((entry) => entry.video === file)) {
      throw new Error(`Printer did not delete ${file}`)
    }
  }

  return {
    connected,
    connect,
    onMessage,
    sendGcodeCommand,
    pausePrint,
    resumePrint,
    cancelPrint,
    emergencyStop,
    startPrint,
    refreshTimelapses,
    deleteTimelapse,
  }
}

/**
 * Subscribe to every parsed WS message. Returns an unsubscribe function.
 * Used by useConsole to receive G-code responses without registering a
 * second handler on the socket.
 */
function onMessage(fn: WsSubscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
