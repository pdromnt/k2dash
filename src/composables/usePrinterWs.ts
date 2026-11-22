import { ref, toRef } from 'vue'
import { getBeltSafetyStatus } from '@/api/moonraker'
import { createBeltCalibrationSession } from '@/printer/beltCalibrationSession'
import { isPreview, previewState, previewMaterials } from '@/utils/preview'
import {
  parsePrintFilaments,
  validateConnectedCfsMappings,
  type PrintSource,
} from '@/printer/materialMapping'
import { usePrinterStore } from '@/stores/printer'
import { createCrealitySocket } from '@/printer/crealitySocket'
import { applyCrealityTelemetry } from '@/printer/crealityTelemetry'
import { applyJobFilamentEstimate, findNativeFile, parseTimelapseList } from '@/printer/crealityMetadata'
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
  pauseCommand,
  resumeCommand,
  startPrintCommand,
  statusRequest,
  timelapseListRequest,
  type CrealityMessage,
} from '@/printer/crealityProtocol'

const STATUS_POLL_MS = 5000
const CFS_POLL_MS = 20000

// One native session shared by every dashboard route.
let starting = false
const printStarting = ref(false)
let startTimer: ReturnType<typeof setTimeout> | undefined
function clearPrintStarting() {
  printStarting.value = false
  clearTimeout(startTimer)
}
let boxsTimer: ReturnType<typeof setInterval> | undefined
let statusTimer: ReturnType<typeof setInterval> | undefined
let fileList: Array<Record<string, unknown>> = []

const socket = createCrealitySocket({
  url: getWsUrl,
  receive,
  onOpen() {
    const store = usePrinterStore()
    belt.resetTelemetry()
    store.modelId = ''
    store.connected = true
    send(initialStateRequest())
    send(statusRequest())
    statusTimer = setInterval(() => send(statusRequest()), STATUS_POLL_MS)
    boxsTimer = setInterval(requestCfs, CFS_POLL_MS)
  },
  onLost() {
    const store = usePrinterStore()
    belt.resetTelemetry()
    store.connected = false
    store.clearMaterials()
    clearInterval(statusTimer)
    clearInterval(boxsTimer)
    fileList = []
  },
})

function send(message: CrealityMessage) {
  return !isPreview && socket.send(message)
}

const belt = createBeltCalibrationSession({
  ready: socket.ready,
  connection: () => socket.current,
  printStarting: () => starting || printStarting.value,
  readSafetyStatus: getBeltSafetyStatus,
  sendGcode: (script, owner) => sendNative(gcodeCommand(script), owner),
})

async function sendNative(message: CrealityMessage, owner?: symbol): Promise<void> {
  if (!belt.canSend(owner))
    throw new Error('Finish or close belt sensor calibration before sending other printer actions')
  if (!send(message))
    throw new Error(
      isPreview
        ? 'Printer actions are disabled in preview'
        : 'Printer disconnected. Reconnect before sending a command.',
    )
}

function requestCfs() {
  send({ method: 'get', params: { boxsInfo: 1 } })
}

function receive(msg: Record<string, unknown>) {
  const store = usePrinterStore()
  const frame = applyCrealityTelemetry(store, msg)
  if (store.jobActive || store.isError) clearPrintStarting()
  // Ask for the filename immediately rather than waiting for the next status poll.
  if (frame.becameActive) send(statusRequest())
  if (frame.cfsTopologyChanged) requestCfs()

  belt.observe(store, msg, frame.nativeStateSeen)

  if (msg.boxsInfo && typeof msg.boxsInfo === 'object') {
    const snapshot = parseCfsSnapshot(msg.boxsInfo as Record<string, unknown>)
    if (snapshot) {
      store.cfsUnits = store.cfsConnected === false ? [] : snapshot.units
      store.spoolSlots = snapshot.spoolSlots
    }
  }
  const filesChanged = Array.isArray(msg.retGcodeFileInfo2)
  if (filesChanged) fileList = (msg.retGcodeFileInfo2 as unknown[]).filter(isRecord)
  if (frame.filenameChanged || filesChanged) applyJobFilamentEstimate(store, fileList)

  const timelapses = parseTimelapseList(msg.elapseVideoList)
  if (timelapses) store.timelapseFiles = timelapses
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function connect() {
  if (isPreview) {
    const store = usePrinterStore()
    const materials = parseCfsSnapshot(previewMaterials())!
    store.$patch({
      modelId: previewState === 'offline' ? '' : K2_PLUS_MODEL_ID,
      connected: previewState !== 'offline',
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
      filamentEstimated: 42900,
      filamentEstimatedWeight: 129,
      fanPart: 0.4,
      ledState: true,
      cfsConnected: materials.units.length > 0,
      cfsUnits: materials.units,
      spoolSlots: materials.spoolSlots,
    })
    return
  }
  if (import.meta.env.VITE_PRINTER_HOST) socket.connect()
}

export function usePrinterWs() {
  const store = usePrinterStore()

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
    belt.invalidate()
    return sendNative(gcodeCommand('M112'))
  }
  async function startPrint(
    path: string,
    options: PrintSource,
  ): Promise<void> {
    if (belt.active.value)
      throw new Error('Close belt sensor calibration before starting a print')
    if (starting || printStarting.value || store.jobActive || store.restartPending)
      throw new Error('A print is already active or starting, or Klipper is restarting')
    starting = true
    printStarting.value = true
    try {
      const commands =
        options.source === 'cfs'
          ? cfsPrintCommands(path, options.mappings)
          : [startPrintCommand(path)]
      for (const command of commands) {
        if (store.jobActive)
          throw new Error('A print started while preparing this job')
        if (options.source === 'cfs')
          validateConnectedCfsMappings(options.mappings, store.cfsSlots)
        await sendNative(command)
      }
      startTimer = setTimeout(clearPrintStarting, 15000)
    } catch (error) {
      clearPrintStarting()
      throw error
    } finally {
      starting = false
    }
  }

  async function getPrintFilaments(path: string) {
    if (isPreview) return [{ id: 'T1A', type: 'PETG', color: '#b8c4b4' }]
    await socket.request(
      { method: 'get', params: { reqGcodeFile: 1, reqGcodeList: 1 } },
      (msg) => Array.isArray(msg.retGcodeFileInfo2),
    )
    const file = findNativeFile(fileList, normalizeGcodePath(path))
    return file ? parsePrintFilaments(file) : []
  }

  async function refreshTimelapses() {
    if (isPreview) return store.timelapseFiles
    await socket.request(timelapseListRequest(), hasTimelapseList)
    return store.timelapseFiles
  }

  async function deleteTimelapse(file: string) {
    if (belt.active.value)
      throw new Error('Close belt sensor calibration before deleting a timelapse')
    // Recent firmware acknowledges ctrlVideoFiles. Older versions do not,
    // so an acknowledgement timeout is non-fatal; the refreshed list is
    // the source of truth either way.
    await socket.request(
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
    connected: toRef(store, 'connected'),
    printStarting,
    beltCalibrationActive: belt.active,
    canStartBeltCalibration: () => belt.canStartBeltCalibration(store),
    canTurnOffBeltHeaters: () => belt.canTurnOffBeltHeaters(store),
    prepareBeltCalibration: (action: 'heaters-off' | 'home-and-park') =>
      belt.prepareBeltCalibration(store, action),
    monitorBeltCalibrationStatus: () => belt.monitorBeltCalibrationStatus(store),
    acquireBeltCalibration: () => belt.acquireBeltCalibration(store),
    connect,
    onMessage: socket.onMessage,
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
