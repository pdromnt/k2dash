import { ref } from 'vue'
import type { usePrinterStore } from '@/stores/printer'
import { isPreview } from '@/utils/preview'

type PrinterStore = ReturnType<typeof usePrinterStore>
type SafetyStatus = { idle: boolean; coolAndOff: boolean }

interface Options {
  ready: () => boolean
  connection: () => WebSocket | null
  printStarting: () => boolean
  readSafetyStatus: () => Promise<SafetyStatus>
  sendGcode: (script: string, owner?: symbol) => Promise<void>
}

const BELT_STATUS_POLL_MS = 2_000
const BELT_STATUS_MAX_AGE_MS = 5_000
const BELT_HEATER_KEYS = [
  'nozzleTemp', 'targetNozzleTemp', 'bedTemp0', 'targetBedTemp0', 'boxTemp', 'targetBoxTemp',
] as const
/** Coordinates one calibration session; transport and command verification live separately. */
export function createBeltCalibrationSession(options: Options) {
  const beltCalibrationActive = ref(false)
  let beltCalibrationOwner: symbol | null = null
  let beltBetweenSteps = false
  let beltSnapshot: (SafetyStatus & { requestedAt: number }) | undefined
  let beltMonitorGeneration = 0
  let beltNativeStateSeen = false
  let beltHeaterRevision = 0

  function invalidateBeltCalibration() {
    beltCalibrationOwner = null
    beltBetweenSteps = false
    beltCalibrationActive.value = false
  }

  function resetBeltTelemetry() {
    beltNativeStateSeen = false
    beltSnapshot = undefined
    if (!beltBetweenSteps) invalidateBeltCalibration()
  }

  function nativeBeltIdle(store: PrinterStore): boolean {
    return ['idle', 'ready', 'complete'].includes(store.state)
  }

  function hasIdleBeltStatus(store: PrinterStore, now = Date.now()): boolean {
    return !isPreview && store.isK2Plus && store.connected && options.ready() &&
      !options.printStarting() && nativeBeltIdle(store) &&
      beltNativeStateSeen && beltSnapshot?.idle === true &&
      now - beltSnapshot.requestedAt <= BELT_STATUS_MAX_AGE_MS
  }

  function hasSafeBeltStatus(store: PrinterStore): boolean {
    return hasIdleBeltStatus(store) && beltSnapshot?.coolAndOff === true
  }

  function observe(store: PrinterStore, msg: Record<string, unknown>, nativeStateSeen: boolean | undefined) {
    if (nativeStateSeen !== undefined) beltNativeStateSeen = nativeStateSeen

    // An unsafe native update overrides a cool snapshot immediately, including
    // a snapshot request that was already in flight when the update arrived.
    const unsafeHeater = BELT_HEATER_KEYS.some((key) => {
      if (!Object.hasOwn(msg, key)) return false
      const raw = msg[key]
      const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN
      return key.startsWith('target') ? value !== 0 : !(value >= 0 && value <= 40)
    })
    if (unsafeHeater) {
      beltHeaterRevision++
      if (beltSnapshot) beltSnapshot.coolAndOff = false
    }

    if (beltCalibrationOwner &&
        (unsafeHeater || (store.modelId !== '' && !store.isK2Plus) ||
          (beltNativeStateSeen && !nativeBeltIdle(store)) ||
          (!beltBetweenSteps && !hasSafeBeltStatus(store)))) invalidateBeltCalibration()
  }

  function canStartBeltCalibration(store: PrinterStore): boolean {
    return hasSafeBeltStatus(store)
  }

  function monitorBeltCalibrationStatus(store: PrinterStore) {
    const generation = ++beltMonitorGeneration
    beltSnapshot = undefined
    let pending = false
    let latestRequest = 0
    async function refresh(force = false) {
      const connection = options.connection()
      if (isPreview || (pending && !force) || generation !== beltMonitorGeneration ||
          !store.connected || !options.ready()) return
      if (force) beltSnapshot = undefined
      const request = ++latestRequest
      const isCurrent = () => request === latestRequest &&
        generation === beltMonitorGeneration && options.connection() === connection && store.connected
      pending = true
      const requestedAt = Date.now()
      const heaterRevision = beltHeaterRevision
      try {
        // Creality pushes deltas, so unchanged targets/state can go unreported.
        // Read a complete safety snapshot; keep Creality as the command transport.
        const status = await options.readSafetyStatus()
        if (isCurrent()) {
          beltSnapshot = {
            ...status,
            coolAndOff: status.coolAndOff && beltHeaterRevision === heaterRevision,
            requestedAt,
          }
          if (beltCalibrationOwner && (!beltSnapshot.idle || !beltSnapshot.coolAndOff))
            invalidateBeltCalibration()
        }
      } catch {
        if (isCurrent()) beltSnapshot = undefined
      } finally {
        if (request === latestRequest) pending = false
        if (isCurrent() && beltCalibrationOwner && !beltBetweenSteps && !hasSafeBeltStatus(store))
          invalidateBeltCalibration()
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), BELT_STATUS_POLL_MS)
    return {
      refresh,
      stop() {
        clearInterval(timer)
        if (generation === beltMonitorGeneration) {
          beltMonitorGeneration++
          beltSnapshot = undefined
          invalidateBeltCalibration()
        }
      },
    }
  }

  function canTurnOffBeltHeaters(store: PrinterStore) {
    return !beltCalibrationOwner && hasIdleBeltStatus(store)
  }

  async function prepareBeltCalibration(store: PrinterStore, action: 'heaters-off' | 'home-and-park') {
    if (!canTurnOffBeltHeaters(store)) {
      throw new Error('Wait for a connected, idle K2 Plus. Close any active calibration session first.')
    }
    if (action === 'home-and-park' && (store.errorCode !== 0 || !canStartBeltCalibration(store))) {
      throw new Error('Wait for the printer to cool and report all heaters off before homing.')
    }
    const script = action === 'heaters-off'
      ? 'M104 S0\nM140 S0\nM141 S0'
      : 'G28\nM400\nBOX_MOVE_TO_SAFE_POS\nM400'
    return options.sendGcode(script)
  }

  function acquireBeltCalibration(store: PrinterStore) {
    if (beltCalibrationOwner) throw new Error('Belt sensor calibration is already open')
    if (!store.isK2Plus) throw new Error('Belt tension calibration requires a detected K2 Plus')
    if (!canStartBeltCalibration(store))
      throw new Error('Waiting for fresh idle, cool printer status with all heaters off')
    const owner = Symbol('belt calibration')
    beltCalibrationOwner = owner
    beltCalibrationActive.value = true
    return {
      async send(script: string) {
        if (beltCalibrationOwner !== owner || beltBetweenSteps || !canStartBeltCalibration(store))
          throw new Error('Belt calibration stopped: current printer status is not safe')
        return options.sendGcode(script, owner)
      },
      waitForNextStep() {
        if (beltCalibrationOwner === owner) beltBetweenSteps = true
      },
      beginStep() {
        if (beltCalibrationOwner !== owner || !canStartBeltCalibration(store)) return false
        beltBetweenSteps = false
        return true
      },
      release() {
        if (beltCalibrationOwner === owner) invalidateBeltCalibration()
      },
    }
  }

  return {
    active: beltCalibrationActive,
    canSend: (owner?: symbol) => !beltCalibrationOwner || beltCalibrationOwner === owner,
    invalidate: invalidateBeltCalibration,
    resetTelemetry: resetBeltTelemetry,
    observe,
    canStartBeltCalibration,
    canTurnOffBeltHeaters,
    prepareBeltCalibration,
    monitorBeltCalibrationStatus,
    acquireBeltCalibration,
  }
}
