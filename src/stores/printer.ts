import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { CfsSlot, CfsUnit } from '@/printer/cfs'
import { K2_PLUS_MODEL_ID, printerModelName } from '@/printer/crealityProtocol'
export type { CfsSlot, CfsUnit } from '@/printer/cfs'

export type PrinterState =
  | 'unknown'
  | 'idle'
  | 'printing'
  | 'paused'
  | 'complete'
  | 'preparing'
  | 'ready'
  | 'error'
  | 'cancelled'
  | 'shutdown'

/**
 * Shape of an entry in the K2 Plus `elapseVideoList` WS payload
 * (returned by `{method:'get', params:{reqElapseVideoList:1}}`).
 *
 * - `name`  : full path including the `gcodes/` prefix
 * - `video` : full printer filesystem path used by `ctrlVideoFiles.file`
 *             in the delete WS message
 * - `videoname`: filename used by `/downloads/video/<videoname>` over HTTP
 * - `starttime`, `duration` are display-only metadata.
 */
export interface TimelapseFile {
  name: string
  video: string
  size: number
  starttime: number
  duration: number
  videoname?: string
}

export const usePrinterStore = defineStore('printer', () => {
  const state = ref<PrinterState>('unknown')
  const modelId = ref('')
  const modelName = computed(() => printerModelName(modelId.value))
  const isK2Plus = computed(() => modelId.value === K2_PLUS_MODEL_ID)
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
  // Tracks which error code the user has manually dismissed so the
  // banner stays hidden until the printer reports a NEW error (a
  // different code). The same error re-asserting won't re-pop the
  // banner — they have to actually clear the fault on the printer.
  const dismissedErrorCode = ref(0)
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
  const cfsConnected = ref<boolean | null>(null)
  const cfsUnits = ref<CfsUnit[]>([])
  const spoolSlots = ref<CfsSlot[]>([])
  const cfsSlots = computed(() =>
    !connected.value
      ? []
      : [
          ...(cfsConnected.value === false
            ? []
            : cfsUnits.value.flatMap((unit) => unit.slots)),
          ...spoolSlots.value,
        ],
  )
  function clearMaterials() {
    cfsConnected.value = null
    cfsUnits.value = []
    spoolSlots.value = []
  }
  const timelapseFiles = ref<TimelapseFile[]>([])
  const position = ref({ x: 0, y: 0, z: 0 })
  const filamentUsed = ref<number | null>(null)

  const isPrinting = computed(
    () => state.value === 'printing' || state.value === 'preparing',
  )
  const isPaused = computed(() => state.value === 'paused')
  const isReady = computed(() => state.value === 'ready')
  const isError = computed(
    () => state.value === 'error' || state.value === 'shutdown',
  )

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
      filamentUsed.value = null
      thumbnailUrl.value = ''
    }
  })

  return {
    state,
    modelId,
    modelName,
    isK2Plus,
    printProgress,
    printFilename,
    currentLayer,
    totalLayers,
    printDuration,
    extruderTemp,
    extruderTarget,
    bedTemp,
    bedTarget,
    chamberTemp,
    chamberTarget,
    fanPart,
    fanAux,
    fanChamber,
    ledState,
    connected,
    filamentEstimated,
    filamentEstimatedWeight,
    printLeftTime,
    thumbnailUrl,
    cfsConnected,
    cfsUnits,
    spoolSlots,
    clearMaterials,
    cfsSlots,
    timelapseFiles,
    errorCode,
    errorMessage,
    dismissedErrorCode,
    wsActive,
    position,
    filamentUsed,
    isPrinting,
    isPaused,
    isReady,
    isError,
  }
})
