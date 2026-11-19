import { reactive, ref } from 'vue'
import { isPreview, previewState, previewMaterials } from '@/utils/preview'
import {
  parsePrintFilaments,
  validateConnectedCfsMappings,
  type PrintSource,
} from '@/printer/materialMapping'
import { usePrinterStore } from '@/stores/printer'
import type { TimelapseFile, PrinterState } from '@/stores/printer'
import { parseCfsSnapshot } from '@/printer/cfs'
import { getWsUrl } from '@/utils/env'
import { normalizeGcodePath } from '@/utils/format'
import {
  cancelCommand,
  cfsPrintCommands,
  deleteTimelapseCommand,
  gcodeCommand,
  hasTimelapseDeleteResult,
  hasTimelapseList,
  initialStateRequest,
  K2_PLUS_MODEL_ID,
  lightCommand,
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
type CommandTransport = 'websocket'

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
  0: 'idle',
  1: 'printing',
  2: 'paused',
  3: 'complete',
  4: 'preparing',
  5: 'error',
}

// ── Module-level state ────────────────────────────────────
// The socket, connection state, pub/sub, and reconnect timers live at
// module scope so every usePrinterWs() caller sees the same instance.
// Without this, useConsole and AppLayout would each get a fresh
// usePrinterWs() with their own disconnected subscribers/connected ref.
let ws: WebSocket | null = null
let starting = false
const printStarting = ref(false)
let startTimer: ReturnType<typeof setTimeout> | undefined
function clearPrintStarting() {
  printStarting.value = false
  clearTimeout(startTimer)
}
const connected = ref(false)
const beltCalibrationActive = ref(false)
let beltCalibrationOwner: symbol | null = null
const BELT_STATUS_MAX_AGE_MS = STATUS_POLL_MS * 2
const BELT_HEATER_KEYS = [
  'nozzleTemp', 'targetNozzleTemp', 'bedTemp0', 'targetBedTemp0',
  'boxTemp', 'targetBoxTemp',
] as const
type BeltHeaterKey = (typeof BELT_HEATER_KEYS)[number]
const beltTelemetry = reactive(new Map<BeltHeaterKey, { value: number; seen: number }>())
const beltStateSeen = ref<number>()

function invalidateBeltCalibration() {
  beltCalibrationOwner = null
  beltCalibrationActive.value = false
}

function resetBeltTelemetry() {
  beltStateSeen.value = undefined
  beltTelemetry.clear()
  invalidateBeltCalibration()
}
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

function hasSafeBeltStatus(store: ReturnType<typeof usePrinterStore>): boolean {
  const now = Date.now()
  if (isPreview || !store.isK2Plus || !connected.value || ws?.readyState !== WebSocket.OPEN ||
      starting || printStarting.value ||
      !['idle', 'ready', 'complete'].includes(store.state) ||
      beltStateSeen.value === undefined || now - beltStateSeen.value > BELT_STATUS_MAX_AGE_MS) return false
  return BELT_HEATER_KEYS.every((key) => {
    const field = beltTelemetry.get(key)
    return field !== undefined && now - field.seen <= BELT_STATUS_MAX_AGE_MS &&
      (key.startsWith('target') ? field.value === 0 : field.value >= 0 && field.value <= 40)
  })
}

function backoff(): number {
  return Math.min(INITIAL_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS)
}

function send(msg: CrealityMessage): boolean {
  if (isPreview || ws?.readyState !== WebSocket.OPEN) return false
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
  if (boxsTimer) {
    clearInterval(boxsTimer)
    boxsTimer = null
  }
  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }
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
  if (isPreview) {
    const store = usePrinterStore()
    const materials = parseCfsSnapshot(previewMaterials())!
    store.$patch({
      modelId: previewState === 'offline' ? '' : K2_PLUS_MODEL_ID,
      connected: previewState !== 'offline',
      wsActive: previewState !== 'offline',
      state:
        previewState === 'printing' || previewState === 'paused'
          ? previewState
          : 'idle',
      extruderTemp: previewState === 'printing' ? 235 : 24.8,
      extruderTarget: previewState === 'printing' ? 235 : 0,
      bedTemp: previewState === 'printing' ? 70 : 25.1,
      bedTarget: previewState === 'printing' ? 70 : 0,
      chamberTemp: 28.4,
      printFilename:
        previewState === 'printing' || previewState === 'paused'
          ? 'Workshop organizer.gcode'
          : '',
      printProgress: 46,
      currentLayer: 243,
      totalLayers: 528,
      printDuration: 9240,
      printLeftTime: 10860,
      filamentUsed: 28400,
      fanPart: 0.4,
      ledState: true,
      cfsConnected: materials.units.length > 0,
      cfsUnits: materials.units,
      spoolSlots: materials.spoolSlots,
    })
    connected.value = previewState !== 'offline'
    return
  }
  if (!import.meta.env.VITE_PRINTER_HOST) return
  // Idempotent: only one socket at a time.
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  )
    return

  const store = usePrinterStore()

  try {
    const socket = new WebSocket(getWsUrl())
    ws = socket

    socket.addEventListener('open', () => {
      resetBeltTelemetry()
      store.modelId = ''
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
      if (ws !== socket) return
      try {
        const msg = JSON.parse(event.data)
        parseAndDispatch(msg)
      } catch {
        /* ignore */
      }
    })

    socket.addEventListener('close', () => {
      if (ws !== socket) return
      resetBeltTelemetry()
      ws = null
      connected.value = false
      store.connected = false
      store.wsActive = false
      store.clearMaterials()
      stopTimers()
      rejectPendingResponses(new Error('Printer WebSocket disconnected'))
      scheduleRetry()
    })

    socket.addEventListener('error', () => {
      if (ws !== socket) return
      resetBeltTelemetry()
      connected.value = false
      store.connected = false
      store.wsActive = false
      store.clearMaterials()
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
  if (typeof msg.model === 'string' && msg.model.trim()) {
    store.modelId = msg.model.trim().toUpperCase()
  }
  if (
    msg.cfsConnect === 0 ||
    msg.cfsConnect === 1 ||
    typeof msg.cfsConnect === 'boolean'
  ) {
    const connected = msg.cfsConnect === 1 || msg.cfsConnect === true
    const changed = store.cfsConnected !== connected
    store.cfsConnected = connected
    if (!connected) store.cfsUnits = []
    // Match CrealityPrint: topology changes request a fresh box snapshot.
    // Reconnection never reuses slots cached before a disconnect.
    if (changed) send({ method: 'get', params: { boxsInfo: 1 } })
  }
  const wasActive =
    store.state === 'printing' ||
    store.state === 'preparing' ||
    store.state === 'paused'
  const n = (v: unknown): number | undefined => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
    if (typeof v === 'string') {
      const p = parseFloat(v)
      return Number.isFinite(p) ? p : undefined
    }
    return undefined
  }

  if (typeof msg.deviceState === 'number') {
    store.state = (DEVICE_STATE_MAP[msg.deviceState] ||
      'unknown') as PrinterState
    if (msg.deviceState === 0) clearPrintJob()
  } else if (typeof msg.deviceState === 'string') {
    store.state = msg.deviceState as PrinterState
    if (msg.deviceState === 'idle') clearPrintJob()
  } else if (typeof msg.state === 'string') {
    store.state = msg.state as PrinterState
  }

  if (Object.hasOwn(msg, 'deviceState') || Object.hasOwn(msg, 'state')) {
    const rawState = msg.deviceState ?? msg.state
    beltStateSeen.value = (typeof rawState === 'number' || typeof rawState === 'string') ? Date.now() : undefined
  }
  for (const key of BELT_HEATER_KEYS) {
    if (!Object.hasOwn(msg, key)) continue
    const raw = msg[key]
    const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim())
      ? Number(raw) : NaN
    if (Number.isFinite(value)) beltTelemetry.set(key, { value, seen: Date.now() })
    else beltTelemetry.delete(key)
  }

  const isActive =
    store.state === 'printing' ||
    store.state === 'preparing' ||
    store.state === 'paused'
  if (isActive || store.isError) clearPrintStarting()
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

  if (beltCalibrationOwner && !hasSafeBeltStatus(store)) invalidateBeltCalibration()

  const pp = n(msg.printProgress)
  // Creality's WS reports percentage points directly (1 means 1%, not
  // 100%). Match CrealityPrint and only clamp malformed firmware values.
  if (pp !== undefined) store.printProgress = normalizeCrealityProgress(pp)
  if (typeof msg.printFileName === 'string') {
    store.printFilename = normalizeGcodePath(msg.printFileName)
    if (store.printFilename && fileList.value.length)
      matchEstimatedData(fileList.value)
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
  if (fu !== undefined) store.filamentUsed = fu

  const mfp = n(msg.modelFanPct)
  if (mfp !== undefined) store.fanPart = mfp / 100
  const cfp = n(msg.auxiliaryFanPct)
  if (cfp !== undefined) store.fanChamber = cfp / 100
  const afp = n(msg.caseFanPct)
  if (afp !== undefined) store.fanAux = afp / 100

  const ls = n(msg.lightSw)
  if (ls !== undefined) store.ledState = ls > 0

  if (msg.curPosition) {
    let pos: { x: number; y: number; z: number } | null = null
    if (typeof msg.curPosition === 'string') {
      const m = (msg.curPosition as string).match(
        /X:([-\d.]+)\s*Y:([-\d.]+)\s*Z:([-\d.]+)/,
      )
      if (m)
        pos = { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) }
      else {
        try {
          const a = JSON.parse(msg.curPosition)
          if (Array.isArray(a) && a.length >= 3)
            pos = { x: n(a[0]) ?? 0, y: n(a[1]) ?? 0, z: n(a[2]) ?? 0 }
        } catch {
          /* ignore */
        }
      }
    } else if (Array.isArray(msg.curPosition)) {
      const a = msg.curPosition as number[]
      if (a.length >= 3)
        pos = { x: n(a[0]) ?? 0, y: n(a[1]) ?? 0, z: n(a[2]) ?? 0 }
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
  const snapshot = parseCfsSnapshot(info)
  if (!snapshot) return
  store.cfsUnits = store.cfsConnected === false ? [] : snapshot.units
  store.spoolSlots = snapshot.spoolSlots
}

function parseFileList(info: unknown) {
  const files = Array.isArray(info)
    ? (info as Array<Record<string, unknown>>)
    : undefined
  if (!files) return

  fileList.value = files
  if (files.length) matchEstimatedData(files)
}

function parseTimelapseList(info: unknown) {
  const store = usePrinterStore()
  const list = Array.isArray(info)
    ? (info as Array<Record<string, unknown>>)
    : undefined
  if (!list) return
  const files: TimelapseFile[] = []
  for (const f of list) {
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
  store.timelapseFiles = files
}

function matchEstimatedData(files: Array<Record<string, unknown>>) {
  const store = usePrinterStore()
  if (!store.printFilename || !files.length) return
  for (const f of files) {
    const name = typeof f.name === 'string' ? f.name : ''
    if (
      name &&
      normalizeGcodePath(name) === normalizeGcodePath(store.printFilename)
    ) {
      if (typeof f.materialUsed === 'string')
        store.filamentEstimated = f.materialUsed
          .split(',')
          .map(Number)
          .filter(Number.isFinite)
          .reduce((a, b) => a + b, 0)
      if (typeof f.filamentWeight === 'string') {
        const weights = f.filamentWeight
          .split(',')
          .map((w) => parseFloat(w.trim()))
          .filter((w) => !isNaN(w))
        const total = weights.reduce((a, b) => a + b, 0)
        if (total > 0) store.filamentEstimatedWeight = total
      }
      break
    }
  }
}

export function usePrinterWs() {
  const store = usePrinterStore()

  function canStartBeltCalibration(): boolean {
    return hasSafeBeltStatus(store)
  }

  function requestBeltCalibrationStatus() {
    send(statusRequest())
  }

  function acquireBeltCalibration() {
    if (beltCalibrationOwner) throw new Error('Belt sensor calibration is already open')
    if (!store.isK2Plus) throw new Error('Belt tension calibration requires a detected K2 Plus')
    if (!canStartBeltCalibration())
      throw new Error('Waiting for fresh idle, cool printer status with all heaters off')
    const owner = Symbol('belt calibration')
    beltCalibrationOwner = owner
    beltCalibrationActive.value = true
    return {
      async send(script: string) {
        if (beltCalibrationOwner !== owner || !canStartBeltCalibration())
          throw new Error('Belt calibration stopped: current printer status is not safe')
        return sendNative(gcodeCommand(script), owner)
      },
      release() {
        if (beltCalibrationOwner === owner) invalidateBeltCalibration()
      },
    }
  }

  async function sendNative(
    message: CrealityMessage,
    owner?: symbol,
  ): Promise<CommandTransport> {
    if (beltCalibrationOwner && beltCalibrationOwner !== owner)
      throw new Error('Finish or close belt sensor calibration before sending other printer actions')
    if (!send(message))
      throw new Error(
        isPreview
          ? 'Printer actions are disabled in preview'
          : 'Printer disconnected. Reconnect before sending a command.',
      )
    return 'websocket'
  }

  function sendGcodeCommand(command: string) {
    return sendNative(gcodeCommand(command))
  }
  function setLight(enabled: boolean) {
    return sendNative(lightCommand(enabled))
  }
  function pausePrint() {
    return sendNative(pauseCommand())
  }
  function resumePrint() {
    return sendNative(resumeCommand())
  }
  function cancelPrint() {
    return sendNative(cancelCommand())
  }
  function emergencyStop() {
    invalidateBeltCalibration()
    return sendNative(gcodeCommand('M112'))
  }
  async function startPrint(
    path: string,
    options: PrintSource,
  ): Promise<CommandTransport> {
    if (beltCalibrationOwner)
      throw new Error('Close belt sensor calibration before starting a print')
    if (starting || printStarting.value || store.isPrinting || store.isPaused)
      throw new Error('A print is already active or starting')
    starting = true
    printStarting.value = true
    try {
      const commands =
        options.source === 'cfs'
          ? cfsPrintCommands(path, options.mappings)
          : [startPrintCommand(path)]
      for (const command of commands) {
        if (store.isPrinting || store.isPaused)
          throw new Error('A print started while preparing this job')
        if (options.source === 'cfs')
          validateConnectedCfsMappings(options.mappings, store.cfsSlots)
        await sendNative(command)
      }
      startTimer = setTimeout(clearPrintStarting, 15000)
      return 'websocket'
    } catch (error) {
      clearPrintStarting()
      throw error
    } finally {
      starting = false
    }
  }

  async function getPrintFilaments(path: string) {
    if (isPreview) return [{ id: 'T1A', type: 'PETG', color: '#b8c4b4' }]
    await requestMessage(
      { method: 'get', params: { reqGcodeFile: 1, reqGcodeList: 1 } },
      (msg) => Array.isArray(msg.retGcodeFileInfo2),
    )
    const file = fileList.value.find(
      (f) =>
        normalizeGcodePath(String(f.path || f.name || '')) ===
        normalizeGcodePath(path),
    )
    return file ? parsePrintFilaments(file) : []
  }

  async function refreshTimelapses() {
    if (isPreview) return store.timelapseFiles
    await requestMessage(timelapseListRequest(), hasTimelapseList)
    return store.timelapseFiles
  }

  async function deleteTimelapse(file: string) {
    if (beltCalibrationOwner)
      throw new Error('Close belt sensor calibration before deleting a timelapse')
    // Recent firmware acknowledges ctrlVideoFiles. Older versions do not,
    // so an acknowledgement timeout is non-fatal; the refreshed list is
    // the source of truth either way.
    await requestMessage(
      deleteTimelapseCommand(file),
      hasTimelapseDeleteResult,
      2500,
    ).catch(() => undefined)
    await refreshTimelapses()
    if (store.timelapseFiles.some((entry) => entry.video === file)) {
      throw new Error(`Printer did not delete ${file}`)
    }
  }

  return {
    connected,
    printStarting,
    beltCalibrationActive,
    canStartBeltCalibration,
    requestBeltCalibrationStatus,
    acquireBeltCalibration,
    connect,
    onMessage,
    sendGcodeCommand,
    setLight,
    pausePrint,
    resumePrint,
    cancelPrint,
    emergencyStop,
    startPrint,
    getPrintFilaments,
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
