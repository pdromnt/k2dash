<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useBannerStore } from '@/stores/banner'
import { usePrinterStore } from '@/stores/printer'
import { getGcodeHelp } from '@/api/moonraker'
import { listenForKlipperOutput } from '@/api/klipperOutput'
import { isPreview } from '@/utils/preview'
import AppIcon from '@/components/ui/AppIcon.vue'
import PrintActions from './PrintActions.vue'
import { createBeltCalibrationTransport } from '@/printer/beltCalibrationLive'
import {
  beltWriteSteps,
  evaluatedBeltFirmware,
  identicalBeltReadback,
  validBeltReadback,
  validBeltTransition,
  type BeltModuleReadback,
  beltCalibrationGuide,
  beltCalibrationJig,
  beltCalibrationVideo,
  beltManualGuide,
  k2Wiki,
} from '@/printer/beltCalibrationWorkflow'

const props = defineProps<{ disabled?: boolean }>()
const ws = usePrinterWs()
const banner = useBannerStore()
const printer = usePrinterStore()
const manualGuide = computed(() => beltManualGuide(printer.modelId))
const phase = ref<
  'closed' | 'prepare' | 'park' | 'write' | 'verify' | 'done' | 'stopped'
>('closed')
const dialog = ref<HTMLDialogElement>()
const heading = ref<HTMLElement>()
const opener = ref<HTMLButtonElement>()
const checked = ref(false)
const index = ref(0)
const attested = ref({
  stock: false,
  parked: false,
  isolated: false,
  experimental: false,
})
const clearForMotion = ref(false)
const commandsChecked = ref(false)
const outputConnected = ref(false)
const outputListeners = new Set<(text: string) => void>()
const heatersRequested = ref(false)
const parkRequested = ref(false)
const prepAction = ref<'check' | 'heaters-off' | 'home-and-park' | null>(null)
const commandIssue = ref('')
const prepIssue = ref('')
const canTurnOffHeaters = ref(false)
let prepGeneration = 0
const fresh = ref(false)
const busy = ref(false)
const issue = ref('')
const mayHaveWritten = ref(false)
const records = ref<BeltModuleReadback[]>([])
const recovery = ref<'waiting' | 'ready' | null>(null)
const slowReconnect = ref(false)
const stepControlsLocked = computed(() =>
  isPreview || busy.value || recovery.value === 'waiting' ||
  !fresh.value || !ws.connected.value || !outputConnected.value,
)
const stageKey = computed(() => phase.value === 'write' ? `write-${index.value}` : phase.value)
const step = computed(() => beltWriteSteps[index.value])
const stageTitle = computed(() => {
  switch (phase.value) {
    case 'prepare':
      return 'Before you begin'
    case 'park':
      return 'Home and park the printer'
    case 'write':
      return step.value?.title
    case 'verify':
      return 'Verify both modules'
    case 'done':
      return 'Module values verified — self-test next'
    default:
      return 'Calibration stopped'
  }
})
const progress = computed(() =>
  phase.value === 'done'
    ? 4
    : phase.value === 'verify'
      ? 3
      : phase.value === 'write'
        ? step.value?.side === 'Right'
          ? 1
          : 2
        : 0,
)
const readyForParking = computed(
  () =>
    printer.isK2Plus &&
    attested.value.stock &&
    attested.value.experimental,
)
const completePreflight = computed(
  () => printer.isK2Plus && commandsChecked.value && outputConnected.value && !prepAction.value &&
    !prepIssue.value && Object.values(attested.value).every(Boolean),
)
const canRequestPark = computed(() =>
  !isPreview && !props.disabled && !busy.value && !prepAction.value && !parkRequested.value &&
  commandsChecked.value && fresh.value && printer.errorCode === 0 &&
  clearForMotion.value && attested.value.isolated,
)

interface LiveSession {
  aborter: InstanceType<typeof window.AbortController>
  lease: ReturnType<typeof ws.acquireBeltCalibration>
  transport: ReturnType<typeof createBeltCalibrationTransport>
}
let session: LiveSession | null = null
let timer: ReturnType<typeof setInterval> | undefined
let statusMonitor: ReturnType<typeof ws.monitorBeltCalibrationStatus> | undefined
let stopOutput: (() => void) | undefined
let visibleRecoveryStartedAt: number | undefined
let needsWakeSnapshot = false
let wakeSnapshotPending = false
let recoveryGeneration = 0
const SLOW_RECONNECT_MS = 15_000

function focusHeading() {
  void nextTick(() => heading.value?.focus())
}
function show(next: typeof phase.value) {
  checked.value = false
  phase.value = next
  focusHeading()
}
function updateRecords(sample: BeltModuleReadback) {
  records.value = [
    ...records.value.filter((value) => value.module !== sample.module),
    sample,
  ].sort((a, b) => a.module.localeCompare(b.module))
}
function clearSession() {
  const previous = session
  session = null
  previous?.aborter.abort()
  previous?.lease.release()
  busy.value = false
}
function finishMonitoring() {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  recoveryGeneration++
  recovery.value = null
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  statusMonitor?.stop()
  statusMonitor = undefined
  stopOutput?.()
  stopOutput = undefined
  outputConnected.value = false
  prepGeneration++
  prepAction.value = null
}
function stop(reason: string) {
  issue.value = reason
  clearSession()
  finishMonitoring()
  show('stopped')
}
function pauseAtCurrentStep() {
  recovery.value = 'waiting'
  slowReconnect.value = false
  checked.value = false
  visibleRecoveryStartedAt = undefined
  needsWakeSnapshot = true
  wakeSnapshotPending = false
  recoveryGeneration++
}

function onVisibilityChange() {
  if (!session) return
  if (busy.value) {
    if (document.hidden)
      stop('The tab was hidden while a printer operation was in progress. The wizard will not retry it.')
    return
  }
  pauseAtCurrentStep()
  checkSafety()
}

function checkRecovery(safe: boolean) {
  if (document.hidden) return
  visibleRecoveryStartedAt ??= Date.now()
  if (needsWakeSnapshot && ws.connected.value && statusMonitor) {
    needsWakeSnapshot = false
    wakeSnapshotPending = true
    const generation = recoveryGeneration
    void Promise.resolve(statusMonitor.refresh(true)).finally(() => {
      if (generation !== recoveryGeneration) return
      wakeSnapshotPending = false
      checkSafety()
    })
  }
  if (!needsWakeSnapshot && !wakeSnapshotPending && safe) {
    recovery.value = 'ready'
  } else {
    slowReconnect.value = Date.now() - visibleRecoveryStartedAt >= SLOW_RECONNECT_MS
  }
}

function checkSafety() {
  fresh.value = ws.canStartBeltCalibration()
  canTurnOffHeaters.value = ws.canTurnOffBeltHeaters()
  if (phase.value === 'park' && parkRequested.value && !session &&
      (!printer.isK2Plus || printer.isError || printer.errorCode !== 0 || printer.jobActive)) {
    stop('Parking could not be confirmed. Wait until the printer is still and check its display. No calibration write was sent.')
  } else if (session) {
    const safe = fresh.value && ws.connected.value && outputConnected.value
    if (busy.value && !safe) {
      stop('The printer stopped reporting a safe, connected, idle state. No further commands were sent.')
    } else if (!busy.value) {
      if ((!safe || document.hidden) && recovery.value !== 'waiting') pauseAtCurrentStep()
      if (recovery.value === 'waiting') checkRecovery(safe)
    }
  }
}
watch(
  ws.beltCalibrationActive,
  (held) => {
    if (session && !held)
      stop(
        'The printer command lock ended. The wizard will not resume automatically.',
      )
  },
  { flush: 'sync' },
)
watch(
  ws.connected,
  (connected) => {
    if (session) {
      if (!connected && busy.value)
        stop('The printer disconnected during an operation. The wizard will not retry it.')
      else checkSafety()
    }
    else if (phase.value === 'park' && !connected && (parkRequested.value || prepAction.value === 'home-and-park'))
      stop('The printer disconnected after the park request. Check the printer before continuing. No calibration write was sent.')
    else {
      if (!connected) {
        prepGeneration++
        prepAction.value = null
        commandsChecked.value = false
        heatersRequested.value = false
        clearForMotion.value = false
        attested.value.parked = false
      }
      checkSafety()
    }
  },
  { flush: 'sync' },
)
const stopListening = ws.onMessage(checkSafety)

async function open() {
  if (phase.value !== 'closed' || !printer.isK2Plus) return
  attested.value = {
    stock: false,
    parked: false,
    isolated: false,
    experimental: false,
  }
  clearForMotion.value = false
  commandsChecked.value = false
  heatersRequested.value = false
  parkRequested.value = false
  commandIssue.value = ''
  prepIssue.value = ''
  records.value = []
  issue.value = ''
  mayHaveWritten.value = false
  index.value = 0
  checkSafety()
  show('prepare')
  await nextTick()
  dialog.value?.showModal()
  heading.value?.focus()
  if (!isPreview) {
    statusMonitor = ws.monitorBeltCalibrationStatus()
    stopOutput = listenForKlipperOutput(
      (text) => { for (const listener of outputListeners) listener(text) },
      (online) => {
        outputConnected.value = online
        if (!online && session && busy.value)
          stop('Live Klipper output disconnected during an operation. The wizard will not retry it.')
        else checkSafety()
      },
    )
    document.addEventListener('visibilitychange', onVisibilityChange)
    timer = setInterval(checkSafety, 1000)
  }
}
function close() {
  if (session) return cancel()
  finishMonitoring()
  phase.value = 'closed'
  dialog.value?.close()
  void nextTick(() => opener.value?.focus())
}
function cancel() {
  stop(
    'You stopped the wizard. A command already sent to the printer cannot be recalled.',
  )
}
function trapFocus(event: KeyboardEvent) {
  const controls = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]',
    ) || [],
  )
  const first = controls[0]
  const last = controls.at(-1)
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === heading.value)
  ) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
function readableError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The printer response could not be verified.'
}

async function checkCommands() {
  if (phase.value !== 'park' || prepAction.value || busy.value || commandsChecked.value) return
  const generation = prepGeneration
  prepAction.value = 'check'
  commandIssue.value = ''
  try {
    const help = await getGcodeHelp()
    if (generation !== prepGeneration) return
    const missing = ['BELT_MDL_INFO', 'BELT_MDL_CALI'].filter((name) => !Object.hasOwn(help, name))
    if (missing.length) {
      commandIssue.value = `Klipper does not list ${missing.join(' or ')}. Do not continue.`
    } else commandsChecked.value = true
  } catch (error) {
    if (generation === prepGeneration)
      commandIssue.value = `Could not check Klipper commands. Check the Moonraker connection and try again. ${readableError(error)}`
  } finally {
    if (generation === prepGeneration) prepAction.value = null
  }
}

async function runPreparation(action: 'heaters-off' | 'home-and-park') {
  if (phase.value !== 'park' || isPreview || props.disabled || prepAction.value || busy.value ||
      (action === 'home-and-park' ? !canRequestPark.value : !canTurnOffHeaters.value || heatersRequested.value)) return
  const generation = prepGeneration
  prepAction.value = action
  prepIssue.value = ''
  attested.value.parked = false
  try {
    await ws.prepareBeltCalibration(action)
    if (generation !== prepGeneration) return
    if (action === 'home-and-park') {
      parkRequested.value = true
      clearForMotion.value = false
    } else heatersRequested.value = true
    void statusMonitor?.refresh()
    checkSafety()
  } catch (error) {
    if (generation === prepGeneration) prepIssue.value = readableError(error)
  } finally {
    if (generation === prepGeneration) prepAction.value = null
  }
}

async function preflight() {
  if (
    isPreview ||
    document.hidden ||
    props.disabled ||
    phase.value !== 'park' ||
    busy.value ||
    !completePreflight.value ||
    !ws.canStartBeltCalibration()
  )
    return
  let active: LiveSession | undefined
  let releaseLease: (() => void) | undefined
  busy.value = true
  try {
    const lease = ws.acquireBeltCalibration()
    releaseLease = lease.release
    const aborter = new window.AbortController()
    active = {
      aborter,
      lease,
      transport: createBeltCalibrationTransport({
        send: lease.send,
        subscribe(listener) {
          outputListeners.add(listener)
          return () => { outputListeners.delete(listener) }
        },
        signal: aborter.signal,
        canSend: () =>
          !document.hidden && outputConnected.value && ws.beltCalibrationActive.value && ws.canStartBeltCalibration(),
      }),
    }
    session = active
    for (const module of ['mdlx', 'mdly'] as const) {
      const sample = await active.transport.read(module)
      if (session !== active) return
      if (!validBeltReadback(module, sample))
        throw new Error(
          'The module did not report a usable saved calibration. This wizard will not initialize a blank or invalid module.',
        )
      updateRecords(sample)
    }
    active.lease.waitForNextStep()
    show('write')
  } catch (error) {
    if (!active) releaseLease?.()
    if (!active || session === active) stop(readableError(error))
  } finally {
    if (session === active) busy.value = false
  }
}

async function runStep() {
  const active = session
  const current = step.value
  if (
    !active ||
    !current ||
    !checked.value ||
    stepControlsLocked.value ||
    document.hidden ||
    !ws.canStartBeltCalibration()
  )
    return
  const before = records.value.find(
    (record) => record.module === current.module,
  )
  if (!before) {
    stop(
      'The module’s previous reading is missing. No further commands were sent.',
    )
    return
  }
  if (!active.lease.beginStep()) return
  const reconnected = recovery.value === 'ready'
  busy.value = true
  recovery.value = null
  try {
    // This stage already re-reads its own module before writing. After an
    // interruption, also verify the other side before permitting any write.
    if (reconnected) {
      const other = records.value.find((record) => record.module !== current.module)
      if (!other || !identicalBeltReadback(other, await active.transport.read(other.module)))
        throw new Error('The other belt module changed since its last verified reading. Do not continue.')
      if (session !== active) return
    }
    mayHaveWritten.value = true
    const result = await active.transport.writeAndRead(
      current.module,
      current.direction,
    )
    if (session !== active) return
    if (!validBeltTransition(current, before, result))
      throw new Error(
        'The saved reading did not match the expected stage. Do not repeat the step blindly.',
      )
    updateRecords(result)
    index.value++
    active.lease.waitForNextStep()
    show(index.value === beltWriteSteps.length ? 'verify' : 'write')
  } catch (error) {
    if (session === active) stop(readableError(error))
  } finally {
    if (session === active) busy.value = false
  }
}

async function verify() {
  const active = session
  if (!active || !checked.value || stepControlsLocked.value ||
      document.hidden || !active.lease.beginStep())
    return
  busy.value = true
  recovery.value = null
  try {
    for (const saved of records.value) {
      const final = await active.transport.read(saved.module)
      if (session !== active) return
      if (!identicalBeltReadback(saved, final))
        throw new Error(
          'The final reading does not match the previously saved module values.',
        )
    }
    clearSession()
    finishMonitoring()
    show('done')
  } catch (error) {
    if (session === active) stop(readableError(error))
  }
}
onUnmounted(() => {
  if (
    phase.value !== 'closed' &&
    phase.value !== 'done' &&
    mayHaveWritten.value
  )
    banner.show(
      'Belt calibration interrupted',
      'A module may be partially calibrated. Inspect the printer and remove any jig safely. Do not start a print until the printer has been checked.',
    )
  stopListening()
  clearSession()
  finishMonitoring()
})
</script>

<template>
  <div class="belt-module-live">
    <div v-if="printer.isK2Plus" class="live-intro">
      <div>
        <h3>[EXPERIMENTAL] Belt Tension Calibration</h3>
        <p>
          <strong>K2 Plus only.</strong> Originally only available
          on the special firmware provided by Creality.
        </p>
      </div>
      <button
        ref="opener"
        class="btn btn-warn"
        type="button"
        :disabled="disabled"
        @click="open"
      >
        Open wizard
      </button>
    </div>
    <div v-else class="live-intro">
      <div>
        <h3>Belt tensioning</h3>
        <p v-if="manualGuide">
          Belt tensioning on the {{ printer.modelName }} is done manually.
          <a :href="manualGuide" target="_blank" rel="noopener noreferrer">{{ printer.modelName }} belt tensioning guide</a>
        </p>
        <p v-else>
          <strong>Experimental belt tension calibration is for the K2 Plus only.</strong>
          If your model isn’t detected, see the <a :href="k2Wiki" target="_blank" rel="noopener noreferrer">Creality wiki</a> for your printer.
        </p>
      </div>
    </div>
    <Teleport to="body">
      <dialog
        ref="dialog"
        class="belt-dialog"
        aria-labelledby="belt-dialog-title"
        @cancel.prevent="close"
        @keydown.tab="trapFocus"
      >
        <div v-if="phase !== 'closed'" class="wizard-shell">
          <header class="wizard-header">
            <h2 id="belt-dialog-title">
              [EXPERIMENTAL] Belt Tension Calibration
            </h2>
            <button
              class="btn btn-ghost close-button"
              type="button"
              :aria-label="
                phase === 'write' || busy || phase === 'verify'
                  ? 'Stop wizard'
                  : 'Close wizard'
              "
              @click="close"
            >
              <AppIcon name="close" :size="18" />
            </button>
          </header>
          <ol
            v-if="phase !== 'stopped'"
            class="wizard-progress"
            aria-label="Calibration progress"
          >
            <li
              v-for="(label, i) in [
                'Prepare',
                'Right belt',
                'Left belt',
                'Verify',
              ]"
              :key="label"
              :class="{ current: progress === i, complete: progress > i }"
              :aria-current="progress === i ? 'step' : undefined"
            >
              {{ label }}
            </li>
          </ol>
          <div :key="stageKey" class="wizard-body" :aria-busy="busy">
            <p v-if="isPreview" class="notice">
              Dashboard preview — printer commands are disabled.
            </p>
            <p v-if="phase === 'write' && step" class="step-label">
              {{ step.side }} belt · Step {{ (index % 4) + 1 }} of 4
            </p>
            <h3 ref="heading" tabindex="-1">{{ stageTitle }}</h3>
            <p v-if="recovery === 'waiting'" role="status" class="notice">
              {{ slowReconnect
                ? 'Still reconnecting. Check the printer’s network connection, or stop the wizard.'
                : 'Rechecking the printer connection and safety status. Calibration controls are locked.' }}
            </p>
            <p v-else-if="recovery === 'ready'" role="status" class="notice">
              Printer status verified. Check that the printer is still parked and the jig matches this step, then confirm again to continue.
            </p>
            <template v-if="phase === 'prepare'">
              <p>
                <strong>K2 Plus only.</strong> For other models, see the
                <a :href="k2Wiki" target="_blank" rel="noopener noreferrer">Creality wiki</a>.
              </p>
              <p>
                This calibrates the belt tension sensors with a printed jig. It
                is not the routine <strong>Belt calibration</strong> macro.
              </p>
              <p class="notice">
                Experimental: firmware code was checked offline; this workflow
                and its replies have not been validated on hardware. Writes
                persist in the belt modules and cannot be undone by this wizard.
              </p>
              <ul class="preparation-list">
                <li>
                  Have Creality’s printed jig ready, but
                  <strong>leave both belts bare</strong>.
                </li>
                <li>
                  Creality specifies normal belt tension of
                  <strong>7.5 N ± 0.5 N</strong>. Check if you can measure it;
                  the guide allows skipping this measurement.
                </li>
                <li>
                  Use a cool, idle K2 Plus with existing, readable calibration
                  values. Blank or invalid modules are not supported.
                </li>
              </ul>
              <nav class="guide-links" aria-label="Calibration resources">
                <a
                  :href="beltCalibrationGuide"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Creality’s guide</a
                >
                <a
                  :href="beltCalibrationJig"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Print the jig</a
                >
                <a
                  :href="beltCalibrationVideo"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Watch the procedure</a
                >
              </nav>
              <p class="service-note">
                The guide’s special firmware and hidden touchscreen menu are the
                original service route. This wizard is for stock firmware;
                do not flash service firmware or change
                languages to use it.
              </p>
              <p>
                <strong>Firmware reference: {{ evaluatedBeltFirmware }}</strong>.
                This is the version used for offline validation. Older and newer versions may work, but compatibility is not guaranteed.
                Stop the wizard if anything differs from the instructions or the expected readings.
              </p>
              <fieldset>
                <legend>Confirm before continuing</legend>
                <label
                  ><input v-model="attested.stock" type="checkbox" />This is a
                  K2 Plus running stock firmware.</label
                >
                <label
                  ><input v-model="attested.experimental" type="checkbox" />I
                  understand that an interruption can leave a partial calibration and that I’m responsible for proceeding and for any issues that result.</label
                >
              </fieldset>
            </template>
            <template v-else-if="phase === 'park'">
              <div class="prep-row">
                <button class="btn" type="button" :disabled="busy || !!prepAction || commandsChecked" @click="checkCommands">
                  {{ prepAction === 'check' ? 'Checking commands…' : 'Check commands' }}
                </button>
                <span v-if="commandsChecked" role="status">Both belt module commands are listed by Klipper.</span>
                <span v-else>Read Klipper’s command list to check that both belt module commands are available.</span>
              </div>
              <p v-if="commandIssue" role="alert" class="notice">{{ commandIssue }}</p>
              <div class="prep-row">
                <button class="btn" type="button" :disabled="isPreview || disabled || busy || !!prepAction || !canTurnOffHeaters || heatersRequested" @click="runPreparation('heaters-off')">Turn heaters off</button>
                <span v-if="heatersRequested && !fresh" role="status">Heater shutdown requested. Wait for the printer to cool.</span>
                <span v-else-if="fresh" role="status">The printer is cool and its heater targets are off.</span>
                <span v-else-if="canTurnOffHeaters">Turn off any active heaters and wait for the printer to cool before parking.</span>
                <span v-else>Waiting for a connected, idle K2 Plus and live printer status.</span>
              </div>
              <fieldset :disabled="busy || !!prepAction">
                <legend>At the printer</legend>
                <label
                  ><input v-model="attested.isolated" type="checkbox" />I am at
                  the printer with emergency stop available. No one else will
                  print, move it, or issue commands during calibration.</label
                >
                <label v-if="!parkRequested"><input v-model="clearForMotion" type="checkbox" />Both belts are bare. The bed and the toolhead’s path are clear of hands, tools, and other objects.</label>
                <button class="btn btn-warn" type="button" :disabled="!canRequestPark" @click="runPreparation('home-and-park')">Home &amp; park printer</button>
                <p v-if="parkRequested" role="status" class="notice">Homing and parking requested, not yet verified. Wait until the printer is completely still and check its position and display. If parking fails or you can’t verify it, stop.</p>
                <p v-else class="service-note">This moves the printer, waits for motion to finish, and uses Creality’s service park command. Skip it if the printer is already homed and correctly parked.</p>
                <label><input v-model="attested.parked" type="checkbox" />I verified that the printer is homed, correctly parked, and completely still. Both belts are bare and the printer reported no error.</label>
              </fieldset>
              <p v-if="prepIssue" role="alert" class="notice">{{ prepIssue }}</p>
              <p>
                The first check only reads both modules. Each later write needs
                a separate confirmation. No automatic retries.
              </p>
              <p v-if="!isPreview && !outputConnected" role="status" class="notice">
                Waiting for live Klipper output. Module reads are disabled until Moonraker connects.
              </p>
              <p v-if="!printer.isK2Plus" role="status" class="notice">
                A K2 Plus is no longer detected. Close the wizard and check the printer connection.
              </p>
            </template>
            <template v-else-if="phase === 'write' || phase === 'verify'">
              <p v-if="phase === 'write' && step">{{ step.instruction }}</p>
              <a
                v-if="phase === 'write' && step?.phase === 'loaded'"
                :href="beltCalibrationGuide"
                target="_blank"
                rel="noopener noreferrer"
                >Check the jig placement in Creality’s guide</a
              >
              <p v-if="phase === 'verify'">
                With both jigs removed, read back the saved position and both
                ADC samples from each module once more. This checks saved
                values; it does not run the printer’s self-test.
              </p>
              <label class="hold-check"
                ><input v-model="checked" type="checkbox" :disabled="stepControlsLocked" />
                {{
                  phase === 'write'
                    ? step?.acknowledgment
                    : 'Both belts are bare, the printer is stationary, and my hands and tools are clear.'
                }}
              </label>
              <p class="service-note">
                Changes are saved directly in the belt modules. “Stop wizard”
                prevents further commands; it cannot recall a command already
                sent.
              </p>
            </template>
            <template v-else-if="phase === 'done'">
              <p>
                Both modules returned the expected saved values.
                <strong
                  >Keep both jigs removed and run the printer’s self-test
                  manually before printing.</strong
                >
              </p>
              <p>
                No self-test was run and no printer configuration save is
                needed: the belt modules store their own values.
              </p>
            </template>
            <template v-else-if="phase === 'stopped'">
              <p role="alert" class="notice">{{ issue }}</p>
              <p v-if="mayHaveWritten">
                <strong
                  >One or both modules may be partially calibrated.</strong
                >
                Wait for the printer to stop, remove any jig safely, and inspect
                or recover using Creality’s service procedure before attempting
                a print. The wizard will not undo or repeat writes.
              </p>
              <p v-else>No calibration write was attempted.</p>
              <p>
                Do not restart blindly. If you cannot confirm a safe recovery,
                contact <a href="mailto:cs@creality.com">cs@creality.com</a>.
              </p>
              <a
                :href="beltCalibrationGuide"
                target="_blank"
                rel="noopener noreferrer"
                >Open Creality’s service guide</a
              >
            </template>
            <p v-if="busy" role="status" class="notice">
              Waiting for a verified printer reply. Do not touch the printer.
            </p>
            <details v-if="records.length" class="readback">
              <summary>Last verified module readings</summary>
              <dl>
                <div v-for="record in records" :key="record.module">
                  <dt>{{ record.module === 'mdlx' ? 'Right' : 'Left' }}</dt>
                  <dd>
                    Position {{ record.position }} · Baseline ADC
                    {{ record.baselineAdc }} · Loaded ADC {{ record.loadedAdc }}
                  </dd>
                </div>
              </dl>
            </details>
          </div>
          <footer class="wizard-footer">
            <div class="live-actions">
              <template v-if="phase === 'prepare'">
                <button class="btn" type="button" @click="close">Close</button>
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="!readyForParking"
                  @click="show('park')"
                >
                  Continue to preparation
                </button>
              </template>
              <template v-else-if="phase === 'park'">
                <button
                  class="btn"
                  :class="{ 'btn-warn wizard-stop': busy }"
                  type="button"
                  :disabled="!!prepAction"
                  @click="busy ? cancel() : show('prepare')"
                >
                  {{ busy ? 'Stop wizard' : 'Back' }}
                </button>
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="
                    isPreview ||
                    busy ||
                    disabled ||
                    !fresh ||
                    !completePreflight
                  "
                  @click="preflight"
                >
                  Read both modules
                </button>
              </template>
              <template v-else-if="phase === 'write' || phase === 'verify'">
                <button class="btn btn-warn wizard-stop" type="button" @click="cancel">
                  Stop wizard
                </button>
                <button
                  class="btn btn-warn"
                  type="button"
                  :disabled="stepControlsLocked || !checked"
                  @click="phase === 'write' ? runStep() : verify()"
                >
                  {{ phase === 'write' ? step?.action : 'Verify saved values' }}
                </button>
              </template>
              <button v-else class="btn" type="button" @click="close">
                Close wizard
              </button>
            </div>
            <PrintActions emergency-only />
          </footer>
        </div>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>
.belt-module-live {
  padding: 16px 18px;
  border-top: 1px solid var(--border);
}
.live-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
h2,
h3 {
  margin: 0;
  font-weight: 650;
  text-wrap: balance;
}
.live-intro h3 {
  font-size: 14px;
}
.live-intro p {
  max-width: 68ch;
  margin-top: 5px;
  font-size: 14px;
}
p {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.6;
}
.belt-dialog {
  margin: auto;
  padding: 0;
  width: min(720px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 32px);
  color: var(--text);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.belt-dialog::backdrop {
  background: #06090dc9;
}
.wizard-shell {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 34px);
}
.wizard-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 24px 12px;
}
.wizard-header h2 {
  flex: 1;
  font-size: 17px;
  line-height: 1.4;
}
.close-button {
  flex: none;
  width: 44px;
  height: 44px;
}
.wizard-progress {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 0 24px 16px;
  margin: 0;
  list-style: none;
}
.wizard-progress li {
  border-bottom: 2px solid var(--border);
  padding: 0 0 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.wizard-progress .current {
  color: var(--text);
  border-color: var(--accent);
  font-weight: 650;
}
.wizard-progress .complete {
  border-color: var(--accent);
}
.wizard-body {
  padding: 22px 24px 26px;
  border-top: 1px solid var(--border);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--border) transparent;
  font-size: 14px;
  animation: wizard-step-arrive 170ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes wizard-step-arrive {
  from { opacity: 0.55; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .wizard-body { animation: none; }
}
.wizard-body > * + * {
  margin-top: 16px;
}
.wizard-body h3 {
  font-size: 21px;
  line-height: 1.3;
}
.wizard-body h3 + p {
  margin-top: 10px;
}
.wizard-body .step-label {
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.wizard-body .step-label + h3 {
  margin-top: 0;
}
.notice {
  padding: 12px 14px;
  background: var(--bg-input);
  color: var(--text);
  border-radius: 7px;
}
a {
  color: var(--blue);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.guide-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.guide-links a {
  display: flex;
  align-items: center;
  min-height: 44px;
}
.preparation-list {
  padding-left: 22px;
  color: var(--text-dim);
  line-height: 1.6;
}
.preparation-list li + li {
  margin-top: 8px;
}
.prep-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.prep-row span {
  flex: 1 1 240px;
  color: var(--text-dim);
}
.wizard-body .btn {
  min-height: 44px;
}
.wizard-body fieldset p {
  margin-block: 8px;
}
strong {
  color: var(--text);
  font-weight: 600;
}
.service-note {
  font-size: 14px;
}
fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
legend {
  margin-bottom: 6px;
  font-weight: 600;
}
fieldset label,
.hold-check {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  min-height: 44px;
  line-height: 1.55;
  cursor: pointer;
}
.hold-check {
  border-block: 1px solid var(--border);
}
input[type='checkbox'] {
  accent-color: var(--accent);
  width: 20px;
  height: 20px;
  margin-top: 2px;
  flex: none;
}
.wizard-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.live-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wizard-footer :deep(.btn) {
  min-height: 44px;
  white-space: normal;
}
.wizard-stop {
  background: transparent;
}
.wizard-stop:hover:not(:disabled) {
  background: color-mix(in srgb, var(--amber) 12%, var(--bg-card));
}
.readback {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.readback summary {
  min-height: 44px;
  align-content: center;
  cursor: pointer;
  color: var(--text-dim);
}
.readback dl {
  margin: 8px 0 0;
}
.readback dl > div + div {
  margin-top: 10px;
}
.readback dt {
  font-weight: 600;
}
.readback dd {
  color: var(--text-dim);
  margin: 3px 0 0;
  overflow-wrap: anywhere;
}
.belt-dialog :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.belt-dialog h3:focus {
  outline: none;
}
@media (max-width: 600px) {
  .belt-module-live {
    padding: 14px 12px;
  }
  .live-intro > .btn {
    width: 100%;
  }
  .wizard-header {
    padding: 12px 16px 8px;
    gap: 8px;
  }
  .wizard-progress {
    padding: 0 16px 12px;
  }
  .wizard-progress li {
    font-size: 11px;
  }
  .wizard-body {
    padding: 18px 16px 22px;
    font-size: 16px;
  }
  .wizard-footer {
    padding: 12px 16px;
  }
  .live-actions {
    width: 100%;
  }
  .live-actions .btn {
    flex: 1 1 100%;
  }
}
</style>
