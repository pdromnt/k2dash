<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useBannerStore } from '@/stores/banner'
import { usePrinterStore } from '@/stores/printer'
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

defineProps<{ disabled?: boolean }>()
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
const fresh = ref(false)
const busy = ref(false)
const issue = ref('')
const mayHaveWritten = ref(false)
const records = ref<BeltModuleReadback[]>([])
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
  () => printer.isK2Plus && Object.values(attested.value).every(Boolean),
)

interface LiveSession {
  aborter: InstanceType<typeof window.AbortController>
  release: () => void
  transport: ReturnType<typeof createBeltCalibrationTransport>
}
let session: LiveSession | null = null
let timer: ReturnType<typeof setInterval> | undefined

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
  previous?.release()
  busy.value = false
}
function finishMonitoring() {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}
function stop(reason: string) {
  issue.value = reason
  clearSession()
  finishMonitoring()
  show('stopped')
}
function checkSafety() {
  fresh.value = ws.canStartBeltCalibration()
  if (session && !fresh.value)
    stop(
      'The printer stopped reporting a safe, connected, idle state. No further commands were sent.',
    )
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
    if (session && !connected)
      stop(
        'The printer disconnected. The wizard will not resume after reconnecting.',
      )
    else checkSafety()
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
    ws.requestBeltCalibrationStatus()
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

async function preflight() {
  if (
    isPreview ||
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
      release: lease.release,
      transport: createBeltCalibrationTransport({
        send: lease.send,
        subscribe: ws.onMessage,
        signal: aborter.signal,
        canSend: () =>
          ws.beltCalibrationActive.value && ws.canStartBeltCalibration(),
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
    busy.value ||
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
  busy.value = true
  checked.value = false
  mayHaveWritten.value = true
  try {
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
    show(index.value === beltWriteSteps.length ? 'verify' : 'write')
  } catch (error) {
    if (session === active) stop(readableError(error))
  } finally {
    if (session === active) busy.value = false
  }
}

async function verify() {
  const active = session
  if (!active || busy.value || !checked.value || !ws.canStartBeltCalibration())
    return
  busy.value = true
  checked.value = false
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
          <div class="wizard-body" :aria-busy="busy">
            <p v-if="isPreview" class="notice">
              Dashboard preview — printer commands are disabled.
            </p>
            <p v-if="phase === 'write' && step" class="step-label">
              {{ step.side }} belt · Step {{ (index % 4) + 1 }} of 4
            </p>
            <h3 ref="heading" tabindex="-1">{{ stageTitle }}</h3>
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
              <p>
                The wizard will not home or park the printer for you. If you
                haven’t prepared it, close this dialog and:
              </p>
              <ol class="preparation-list">
                <li>
                  Leave both belts bare and use
                  <strong>Home all axes</strong> in Printer controls.
                </li>
                <li>Send <code>BOX_MOVE_TO_SAFE_POS</code> in Console.</li>
                <li>
                  Wait for motion to stop and verify the service position. If
                  parking fails or is unconfirmed, do not continue.
                </li>
              </ol>
              <fieldset :disabled="busy">
                <legend>At the printer</legend>
                <label
                  ><input v-model="attested.parked" type="checkbox" />I homed
                  and parked the printer with both belts bare. It is cool,
                  stationary, and clear of hands and tools.</label
                >
                <label
                  ><input v-model="attested.isolated" type="checkbox" />I am at
                  the printer with emergency stop available. No one else will
                  print, move it, or issue commands during calibration.</label
                >
              </fieldset>
              <p>
                The first check only reads both modules. Each later write needs
                a separate confirmation. No automatic retries.
              </p>
              <p v-if="!printer.isK2Plus" role="status" class="notice">
                A K2 Plus is no longer detected. Close the wizard and check the printer connection.
              </p>
              <p v-else-if="!fresh && !isPreview" role="status" class="notice">
                Waiting for a fresh idle, cool, heaters-off status. Do not
                continue until the printer reports it.
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
                ><input v-model="checked" type="checkbox" :disabled="busy" />
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
                  type="button"
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
                <button class="btn" type="button" @click="cancel">
                  Stop wizard
                </button>
                <button
                  class="btn btn-warn"
                  type="button"
                  :disabled="isPreview || busy || !checked || !fresh"
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
