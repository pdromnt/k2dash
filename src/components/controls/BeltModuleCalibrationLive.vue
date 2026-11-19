<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useBannerStore } from '@/stores/banner'
import { isPreview } from '@/utils/preview'
import { beltCalibrationGuide } from '@/printer/beltCalibrationPreview'
import { createBeltCalibrationTransport } from '@/printer/beltCalibrationLive'
import {
  beltWriteSteps, experimentalBeltFirmware, identicalBeltReadback,
  validBeltReadback, validBeltTransition, type BeltModuleReadback,
} from '@/printer/beltCalibrationWorkflow'

defineProps<{ disabled?: boolean }>()
const ws = usePrinterWs()
const banner = useBannerStore()
const phase = ref<'closed' | 'prepare' | 'write' | 'verify' | 'done' | 'stopped'>('closed')
const heading = ref<HTMLElement>()
const opener = ref<HTMLButtonElement>()
const checked = ref(false)
const index = ref(0)
const firmware = ref('')
const attested = ref({ stock: false, parked: false, isolated: false, experimental: false })
const fresh = ref(false)
const busy = ref(false)
const issue = ref('')
const mayHaveWritten = ref(false)
const records = ref<BeltModuleReadback[]>([])
const step = computed(() => beltWriteSteps[index.value])
const completePreflight = computed(() =>
  experimentalBeltFirmware.some((v) => v === firmware.value) &&
  Object.values(attested.value).every(Boolean),
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
  records.value = [...records.value.filter((value) => value.module !== sample.module), sample]
    .sort((a, b) => a.module.localeCompare(b.module))
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
  if (session && !fresh.value) stop('The printer stopped reporting a safe, connected, idle state. No further commands were sent.')
}
watch(ws.beltCalibrationActive, (held) => {
  if (session && !held) stop('The printer command lock ended. The wizard will not resume automatically.')
}, { flush: 'sync' })
watch(ws.connected, (connected) => {
  if (session && !connected) stop('The printer disconnected. The wizard will not resume after reconnecting.')
  else checkSafety()
}, { flush: 'sync' })
const stopListening = ws.onMessage(checkSafety)

function open() {
  if (isPreview || phase.value !== 'closed') return
  firmware.value = ''
  attested.value = { stock: false, parked: false, isolated: false, experimental: false }
  records.value = []
  issue.value = ''
  mayHaveWritten.value = false
  index.value = 0
  checkSafety()
  show('prepare')
  ws.requestBeltCalibrationStatus()
  timer = setInterval(checkSafety, 1000)
}
function close() {
  if (session) return cancel()
  finishMonitoring()
  phase.value = 'closed'
  void nextTick(() => opener.value?.focus())
}
function cancel() {
  stop('You stopped the wizard. A command already sent to the printer cannot be recalled.')
}
function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'The printer response could not be verified.'
}

async function preflight() {
  if (isPreview || busy.value || !completePreflight.value || !ws.canStartBeltCalibration()) return
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
        canSend: () => ws.beltCalibrationActive.value && ws.canStartBeltCalibration(),
      }),
    }
    session = active
    for (const module of ['mdlx', 'mdly'] as const) {
      const sample = await active.transport.read(module)
      if (session !== active) return
      if (!validBeltReadback(module, sample))
        throw new Error('The module did not report a usable saved calibration. This wizard will not initialize a blank or invalid module.')
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
  if (!active || !current || !checked.value || busy.value || !ws.canStartBeltCalibration()) return
  const before = records.value.find((record) => record.module === current.module)
  if (!before) {
    stop('The module’s previous reading is missing. No further commands were sent.')
    return
  }
  busy.value = true
  checked.value = false
  mayHaveWritten.value = true
  try {
    const result = await active.transport.writeAndRead(current.module, current.direction)
    if (session !== active) return
    if (!validBeltTransition(current, before, result))
      throw new Error('The saved reading did not match the expected stage. Do not repeat the step blindly.')
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
  if (!active || busy.value || !checked.value || !ws.canStartBeltCalibration()) return
  busy.value = true
  checked.value = false
  try {
    for (const saved of records.value) {
      const final = await active.transport.read(saved.module)
      if (session !== active) return
      if (!identicalBeltReadback(saved, final)) throw new Error('The final reading does not match the previously saved module values.')
    }
    clearSession()
    finishMonitoring()
    show('done')
  } catch (error) {
    if (session === active) stop(readableError(error))
  }
}
onUnmounted(() => {
  if (phase.value !== 'closed' && phase.value !== 'done' && mayHaveWritten.value)
    banner.show('Belt calibration interrupted', 'A module may be partially calibrated. Inspect the printer and remove any jig safely. Do not start a print until the printer has been checked.')
  stopListening()
  clearSession()
  finishMonitoring()
})
</script>

<template>
  <div v-if="!isPreview" class="belt-module-live">
    <div v-if="phase === 'closed'" class="live-intro">
      <div>
        <h3>Experimental live calibration</h3>
        <p>Service procedure for a parked K2 Plus. Requires an existing, readable belt calibration; it cannot initialize a blank module.</p>
      </div>
      <button ref="opener" class="btn btn-warn" type="button" :disabled="disabled" @click="open">Review live setup</button>
    </div>
    <template v-else>
      <p class="live-warning">Live printer · Changes are saved in the belt modules</p>
      <h3 ref="heading" tabindex="-1">
        {{ phase === 'prepare' ? 'Prepare the printer'
          : phase === 'write' ? step?.title
          : phase === 'verify' ? 'Confirm the final readbacks'
          : phase === 'done' ? 'Both modules verified'
          : 'Live calibration stopped' }}
      </h3>
      <template v-if="phase === 'prepare'">
        <p>Firmware code was checked offline; running this workflow and receiving its replies in K2Dash have not been validated on hardware.</p>
        <a :href="beltCalibrationGuide" target="_blank" rel="noopener noreferrer">Creality’s jig and service guide (opens in a new tab)</a>
        <label class="version-field">
          Stock printer firmware shown under Settings
          <select v-model="firmware" class="input" :disabled="busy">
            <option value="">Choose an evaluated version</option>
            <option v-for="v in experimentalBeltFirmware" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <p>Before opening live setup, leave both belts bare. In Printer controls use Home all axes, then send <code>BOX_MOVE_TO_SAFE_POS</code> in Console and wait until the printer is stationary. If parking fails or is unconfirmed, do not continue.</p>
        <fieldset :disabled="busy">
          <legend>Before contacting the belt modules</legend>
          <label><input v-model="attested.stock" type="checkbox">This is a K2 Plus using the selected stock firmware.</label>
          <label><input v-model="attested.parked" type="checkbox">I homed the printer and verified its service position with both belts bare. The printer is parked, cool, and clear of hands and tools.</label>
          <label><input v-model="attested.isolated" type="checkbox">I am at the printer with emergency stop available. No one else will run a print, move the printer, or issue commands during calibration.</label>
          <label><input v-model="attested.experimental" type="checkbox">I understand live writes are experimental and an interruption can leave a partial calibration.</label>
        </fieldset>
        <p v-if="!fresh" role="status">Waiting for a fresh idle, cool, heaters-off status from the printer.</p>
        <div class="live-actions">
          <button class="btn" type="button" @click="busy ? cancel() : close()">{{ busy ? 'Stop wizard' : 'Close setup' }}</button>
          <button class="btn btn-primary" type="button" :disabled="busy || disabled || !fresh || !completePreflight" @click="preflight">Read both modules</button>
        </div>
      </template>
      <template v-else-if="phase === 'write' || phase === 'verify'">
        <p v-if="phase === 'write' && step" class="step-label">Write {{ index + 1 }} of {{ beltWriteSteps.length }} · {{ step.side }} belt</p>
        <p v-if="phase === 'write' && step">{{ step.instruction }}</p>
        <a v-if="step?.phase === 'loaded'" :href="beltCalibrationGuide" target="_blank" rel="noopener noreferrer">Open the jig guide (opens in a new tab)</a>
        <p v-if="phase === 'verify'">With both jigs removed, read back the saved position and both samples from each module again. This does not run a self-test.</p>
        <label class="hold-check"><input v-model="checked" type="checkbox" :disabled="busy">
          {{ phase === 'write' ? step?.acknowledgment : 'Both belts are bare, the printer is stationary, and my hands and tools are clear.' }}
        </label>
        <div class="live-actions">
          <button class="btn" type="button" @click="cancel">Stop wizard</button>
          <button class="btn btn-warn" type="button" :disabled="busy || !checked || !fresh" @click="phase === 'write' ? runStep() : verify()">
            {{ phase === 'write' ? step?.action : 'Verify saved values' }}
          </button>
        </div>
      </template>
      <template v-else>
        <p v-if="phase === 'done'">With both jigs removed, run the printer’s self-test manually before printing. The wizard did not run it or save the printer configuration.</p>
        <template v-else>
          <p role="alert">{{ issue }}</p>
          <p v-if="mayHaveWritten">One or both modules may be partially calibrated. Wait for the printer to stop, remove any jig safely, and inspect or recover using Creality’s service procedure before attempting a print. The wizard will not undo or repeat writes.</p>
          <p v-else>No calibration write was attempted.</p>
        </template>
        <div class="live-actions"><button class="btn" type="button" @click="close">Close live wizard</button></div>
      </template>
      <p v-if="busy" role="status">Waiting for the printer’s verified readback. Do not touch the printer during this step.</p>
      <dl v-if="records.length" class="readback">
        <div v-for="record in records" :key="record.module">
          <dt>{{ record.module === 'mdlx' ? 'Right' : 'Left' }} · last verified reading</dt>
          <dd>Position {{ record.position }} · Baseline ADC {{ record.baselineAdc }} · Loaded ADC {{ record.loadedAdc }}</dd>
        </div>
      </dl>
    </template>
  </div>
</template>

<style scoped>
.belt-module-live { padding: 16px 18px; border-top: 1px solid var(--border); }
.live-intro { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
h3 { margin: 0; font-size: .96rem; font-weight: 650; }
p, fieldset, select, .readback, .hold-check { font-size: .875rem; line-height: 1.55; max-width: 68ch; }
p { margin: 5px 0; color: var(--text-dim); }
p.live-warning { color: var(--amber); font-weight: 650; margin: 0 0 9px; }
p.step-label { color: var(--text-mute); font-variant-numeric: tabular-nums; }
a { color: var(--blue); display: inline-block; margin-top: 5px; text-decoration: underline; text-underline-offset: 3px; font-size: .875rem; }
.version-field { display: grid; gap: 5px; justify-items: start; margin: 11px 0; font-size: .875rem; }
fieldset { padding: 8px 11px; border: 1px solid var(--border); border-radius: 8px; }
legend { padding: 0 4px; color: var(--text-dim); }
fieldset label, .hold-check { display: flex; align-items: center; gap: 10px; min-height: 44px; }
input[type='checkbox'] { accent-color: var(--accent); width: 18px; height: 18px; flex: none; }
.live-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 5px; }
.readback { padding: 8px 11px; border: 1px solid var(--border); border-radius: 8px; margin: 10px 0 0; font-variant-numeric: tabular-nums; }
.readback > div + div { margin-top: 4px; }
.readback dt { font-weight: 600; }
.readback dd { color: var(--text-dim); }
@media (max-width: 520px) {
  .belt-module-live { padding: 14px 12px; }
  .live-intro > .btn { width: 100%; }
  .live-actions > .btn-warn, .live-actions > .btn-primary { flex-basis: 100%; }
}
</style>
