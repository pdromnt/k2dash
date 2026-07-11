import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { normalizeGcodePath } from '@/utils/format'

export type PrinterState = 'unknown' | 'idle' | 'printing' | 'paused' | 'complete' | 'preparing' | 'ready' | 'error' | 'cancelled' | 'shutdown'

export interface CfsSlot {
  boxId: number
  materialId: number
  type: string
  color: string
  name: string
  vendor: string
  percent: number
  minTemp: number
  maxTemp: number
  state: number
  isSpool: boolean
}

/**
 * Shape of an entry in the K2 Plus `elapseVideoList` WS payload
 * (returned by `{method:'get', params:{reqElapseVideoList:1}}`).
 *
 * - `name`  : full path including the `gcodes/` prefix
 * - `video` : bare filename used by the printer's
 *             `/downloads/video/<video>` HTTP endpoint and by
 *             `ctrlVideoFiles.file` in the delete WS message
 * - `videoname`, `starttime`, `duration` are display-only metadata.
 */
export interface TimelapseFile {
  name: string
  video: string
  size: number
  starttime: number
  duration: number
  videoname?: string
}

// Klipper `output_pin fan{N}` → store field for fans that accept a 0-1 value.
const FAN_PINS = [
  { pin: 'fan0', field: 'fanPart' as const },
  { pin: 'fan1', field: 'fanAux' as const },
  { pin: 'fan2', field: 'fanChamber' as const },
]

export const usePrinterStore = defineStore('printer', () => {
  const state = ref<PrinterState>('unknown')
  const printProgress = ref(0)
  const printFilename = ref('')
  const currentLayer = ref(0)
  const totalLayers = ref(0)
  const printDuration = ref(0)
  // K2 Plus WS pushes a nested `err` object when the printer is in an
  // error state: {errcode: <int>, value: <string>}. The webview-shaped
  // variant (CrealityPrint's relay) uses {key, value} — handle both.
  const errorCode = ref(0)
  const errorMessage = ref('')
  const extruderTemp = ref(0)
  const extruderTarget = ref(0)
  const bedTemp = ref(0)
  const bedTarget = ref(0)
  const chamberTemp = ref(0)
  const chamberTarget = ref(0)
  const fanPart = ref(0)
  const fanAux = ref(0)
  const fanChamber = ref(0)
  const ledState = ref(false)
  const connected = ref(false)
  const filamentEstimated = ref(0)
  const filamentEstimatedWeight = ref(0)
  const printLeftTime = ref(0)
  const thumbnailUrl = ref('')
  const wsActive = ref(false)
  const cfsName = ref('')
  const cfsHumidity = ref<number | null>(null)
  const cfsTemp = ref<number | null>(null)
  const cfsSlots = ref<CfsSlot[]>([])
  const timelapseFiles = ref<TimelapseFile[]>([])
  const position = ref({ x: 0, y: 0, z: 0 })
  const filamentUsed = ref(0)

  const isPrinting = computed(() => state.value === 'printing' || state.value === 'preparing')
  const isPaused = computed(() => state.value === 'paused')
  const isReady = computed(() => state.value === 'ready')
  const isError = computed(() => state.value === 'error' || state.value === 'shutdown')

  // Whenever the printer leaves an active-job state, wipe all the job-scoped
  // data so a stale value from a previous run can't leak into the UI.
  const JOB_STATES = new Set<PrinterState>(['printing', 'preparing', 'paused'])
  watch(state, (s) => {
    if (!JOB_STATES.has(s)) {
      printProgress.value = 0
      printFilename.value = ''
      currentLayer.value = 0
      totalLayers.value = 0
      printDuration.value = 0
      printLeftTime.value = 0
      filamentEstimated.value = 0
      filamentEstimatedWeight.value = 0
      filamentUsed.value = 0
      thumbnailUrl.value = ''
    }
  })

  function updateFromData(data: Record<string, unknown>) {
    if (data.print_stats) {
      const ps = data.print_stats as Record<string, unknown>
      if (!wsActive.value && typeof ps.state === 'string') state.value = ps.state as PrinterState
      if (typeof ps.filename === 'string' && ps.filename) printFilename.value = normalizeGcodePath(ps.filename)
      if (typeof ps.print_duration === 'number') printDuration.value = ps.print_duration
      if (typeof ps.filament_used === 'number') filamentUsed.value = ps.filament_used
      // Layers: always accept from Moonraker (WS layer field is unreliable)
      if (ps.info && typeof ps.info === 'object') {
        const info = ps.info as Record<string, unknown>
        if (typeof info.current_layer === 'number') currentLayer.value = info.current_layer
        if (typeof info.total_layer === 'number') totalLayers.value = info.total_layer
      }
    }

    if (!wsActive.value && data.extruder) {
      const e = data.extruder as Record<string, unknown>
      if (typeof e.temperature === 'number') extruderTemp.value = e.temperature
      if (typeof e.target === 'number') extruderTarget.value = e.target
    }

    if (!wsActive.value && data.heater_bed) {
      const b = data.heater_bed as Record<string, unknown>
      if (typeof b.temperature === 'number') bedTemp.value = b.temperature
      if (typeof b.target === 'number') bedTarget.value = b.target
    }

    if (!wsActive.value && data['temperature_sensor chamber_temp']) {
      const c = data['temperature_sensor chamber_temp'] as Record<string, unknown>
      if (typeof c.temperature === 'number') chamberTemp.value = c.temperature
    }

    if (!wsActive.value && data['heater_generic chamber_heater']) {
      const h = data['heater_generic chamber_heater'] as Record<string, unknown>
      if (typeof h.temperature === 'number') chamberTemp.value = h.temperature
      if (typeof h.target === 'number') chamberTarget.value = h.target
    }

    if (!wsActive.value && data.toolhead) {
      const th = data.toolhead as Record<string, unknown>
      if (th.position && Array.isArray(th.position)) {
        const pos = th.position as number[]
        position.value = { x: pos[0], y: pos[1], z: pos[2] }
      }
    }

    for (const { pin, field } of FAN_PINS) {
      if (!wsActive.value && data[`output_pin ${pin}`]) {
        const f = data[`output_pin ${pin}`] as Record<string, unknown>
        if (typeof f.value === 'number') {
          // Mirror to the right ref — use a tiny lookup so the loop stays
          // data-driven without losing the per-field type.
          if (field === 'fanPart') fanPart.value = f.value
          else if (field === 'fanAux') fanAux.value = f.value
          else if (field === 'fanChamber') fanChamber.value = f.value
        }
      }
    }

    if (!wsActive.value && data['output_pin LED']) {
      const l = data['output_pin LED'] as Record<string, unknown>
      if (typeof l.value === 'number') ledState.value = l.value > 0
    }

    if (!wsActive.value && data.motion_report) {
      const mr = data.motion_report as Record<string, unknown>
      if (mr.live_position && Array.isArray(mr.live_position)) {
        const lp = mr.live_position as number[]
        position.value = { x: lp[0], y: lp[1], z: lp[2] }
      }
    }
  }

  return {
    state, printProgress, printFilename,
    currentLayer, totalLayers, printDuration,
    extruderTemp, extruderTarget, bedTemp, bedTarget,
    chamberTemp, chamberTarget,
    fanPart, fanAux, fanChamber, ledState,
    connected, filamentEstimated, filamentEstimatedWeight, printLeftTime, thumbnailUrl,
    cfsName, cfsHumidity, cfsTemp, cfsSlots, timelapseFiles,
    errorCode, errorMessage,
    wsActive,
    position, filamentUsed,
    isPrinting, isPaused, isReady, isError,
    updateFromData,
  }
})
