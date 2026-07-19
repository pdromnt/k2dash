<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { fanGcode, type CrealityFan } from '@/printer/crealityProtocol'
import { errMsg } from '@/utils/format'

const printer = usePrinterStore()
const banner = useBannerStore()
const toast = useToastStore()
const printerWs = usePrinterWs()

const jog = ref(10)
const fanSliders = ref([printer.fanPart, printer.fanAux, printer.fanChamber])
const ledBusy = ref(false)
const jobActive = computed(() => printer.isPrinting || printer.isPaused)

watch(() => [printer.fanPart, printer.fanAux, printer.fanChamber], ([p, a, c]) => {
  fanSliders.value = [p, a, c]
})

async function cmd(script: string, label?: string) {
  if (!import.meta.env.VITE_PRINTER_HOST) return
  try {
    await printerWs.sendGcodeCommand(script)
    toast.show(label ? `${label} · OK` : `OK · ${script.split('\n')[0]}`)
  } catch (e) {
    banner.show('Failed to send G-code', errMsg(e))
  }
}

async function allOff() {
  if (jobActive.value) return
  try {
    await Promise.all([
      printerWs.sendGcodeCommand('M104 S0'),
      printerWs.sendGcodeCommand('M140 S0'),
      printerWs.sendGcodeCommand('M141 S0'),
    ])
    toast.show('All heaters off')
  } catch (e) {
    banner.show('Failed to turn heaters off', errMsg(e))
  }
}

async function setTemp(heater: string, temp: string) {
  if (jobActive.value) return
  const t = parseFloat(temp)
  if (isNaN(t)) return

  // M-codes via the K2 Plus WS work (the console uses the same
  // channel). Klipper's `SET_HEATER_TEMPERATURE` and the K1's
  // `boxTempControl` param both 500 / fail on the K2 Plus firmware,
  // so the universal fallback is the M-code path.
  if (heater === 'heater_generic chamber_heater') {
    // M141 sets the chamber target. K2 Plus firmware runs Klipper
    // underneath so this should work; if not it no-ops silently.
    await cmd(`M141 S${t}`, `Chamber target \u00b7 ${t}\u00b0C`)
    return
  }

  // M104 = extruder, M140 = bed. Both work via `gcodeCmd`.
  const mcode = heater === 'heater_bed' ? `M140 S${t}` : `M104 S${t}`
  await cmd(mcode, `${heater === 'heater_bed' ? 'Bed' : 'Extruder'} target \u00b7 ${t}\u00b0C`)
}

async function runPrintAction(label: string, action: () => Promise<unknown>) {
  try {
    await action()
    toast.show(label)
  } catch (e) {
    banner.show(`${label} failed`, errMsg(e))
  }
}

function pauseJob() {
  return runPrintAction('Print paused', printerWs.pausePrint)
}

function resumeJob() {
  return runPrintAction('Print resumed', printerWs.resumePrint)
}

function cancelJob() {
  if (!confirm('Cancel the current print?')) return
  return runPrintAction('Print cancelled', printerWs.cancelPrint)
}

function stopPrinter() {
  if (!confirm('EMERGENCY STOP? The printer will require a firmware restart.')) return
  return runPrintAction('Emergency stop sent', printerWs.emergencyStop)
}

async function setFan(fan: CrealityFan, pct: number) {
  await cmd(fanGcode(fan, pct), `Fan \u00b7 ${Math.round(pct)}%`)
}

async function toggleLed() {
  if (ledBusy.value) return
  const enabled = !printer.ledState
  ledBusy.value = true
  try {
    await printerWs.setLight(enabled)
    toast.show(`LED ${enabled ? 'ON' : 'OFF'} · OK`)
  } catch (e) {
    banner.show('Failed to toggle chamber light', errMsg(e))
  } finally {
    ledBusy.value = false
  }
}

interface HeaterConfig {
  label: string
  heater: 'extruder' | 'heater_bed' | 'heater_generic chamber_heater'
  current: number
  defaultTarget: number
  model: { value: string }
}

const tE = ref(String(printer.extruderTarget || 200))
const tB = ref(String(printer.bedTarget || 60))
const tC = ref(String(printer.chamberTarget || 0))

const heaters = computed<HeaterConfig[]>(() => [
  { label: 'Extruder', heater: 'extruder', current: printer.extruderTemp, defaultTarget: 200, model: tE },
  { label: 'Bed',      heater: 'heater_bed', current: printer.bedTemp,    defaultTarget: 60,  model: tB },
  { label: 'Chamber',  heater: 'heater_generic chamber_heater', current: printer.chamberTemp, defaultTarget: 0, model: tC },
])

function fanLabel(speed: number): string {
  return `${Math.round(speed * 100)}%`
}

const fans = [
  { label: 'Part', type: 'part' },
  { label: 'Case', type: 'case' },
  { label: 'Side', type: 'side' },
] satisfies Array<{ label: string; type: CrealityFan }>

interface UtilityCommand {
  label: string
  gcode: string
  confirmation?: string
  warning?: string
}

const utilities: UtilityCommand[] = [
  { label: 'Motors off', gcode: 'M84' },
  {
    label: 'Load filament',
    gcode: 'LOAD_MATERIAL',
    confirmation: 'Load filament? The printer may heat the nozzle and move filament.',
  },
  {
    label: 'Unload filament',
    gcode: 'QUIT_MATERIAL',
    confirmation: 'Unload filament? The printer may heat the nozzle, cut, and retract filament.',
  },
]

const maintenanceCommands: UtilityCommand[] = [
  {
    label: 'Bed leveling',
    gcode: 'G29',
    confirmation: 'Run automatic bed leveling? This heats and moves the printer and may take several minutes.',
  },
  {
    label: 'Input shaping',
    gcode: 'INPUTSHAPER',
    confirmation: 'Run input shaping calibration? The printer will home, move, vibrate, and save new calibration values.',
  },
  {
    label: 'Belt calibration',
    gcode: 'BELT_TENSION',
    confirmation: 'Run belt calibration? Keep clear of the printer until it finishes.',
  },
  {
    label: 'Z calibration',
    gcode: 'Z_AXIS_CALIBRATION',
    confirmation: 'Run Z-axis calibration? The printer will heat, home, clean the nozzle, and replace saved calibration values.',
  },
  {
    label: 'Nozzle PID',
    gcode: 'NOZZLE_PID',
    warning: 'ONLY USE THIS IF NECESSARY',
    confirmation: 'Run nozzle PID calibration at 230°C and save the result? Only continue if recalibration is necessary.',
  },
  {
    label: 'Bed PID',
    gcode: 'BEDPID',
    warning: 'ONLY USE THIS IF NECESSARY',
    confirmation: 'Run bed PID calibration at 100°C and save the result? Only continue if recalibration is necessary.',
  },
]

async function runUtility(command: UtilityCommand) {
  if (jobActive.value) return
  if (command.confirmation && !window.confirm(command.confirmation)) return
  await cmd(command.gcode, command.label)
}

function runIdleCommand(command: string) {
  if (jobActive.value) return
  return cmd(command)
}

const commandTip = reactive({ text: '', visible: false, x: 0, y: 0 })

interface TooltipHoverEvent {
  currentTarget: {
    getBoundingClientRect: () => { left: number; width: number; bottom: number }
  }
}

function isTooltipHoverEvent(event: unknown): event is TooltipHoverEvent {
  if (!event || typeof event !== 'object' || !('currentTarget' in event)) return false
  const target = event.currentTarget
  return !!target
    && typeof target === 'object'
    && 'getBoundingClientRect' in target
    && typeof target.getBoundingClientRect === 'function'
}

function showCommandTip(event: unknown, command: UtilityCommand) {
  const text = jobActive.value
    ? `Unavailable during an active print${command.warning ? ` · ${command.warning}` : ''}`
    : command.warning
  if (!text || !isTooltipHoverEvent(event)) return
  const rect = event.currentTarget.getBoundingClientRect()
  commandTip.text = text
  commandTip.x = rect.left + rect.width / 2
  commandTip.y = rect.bottom + 8
  commandTip.visible = true
}

function hideCommandTip() {
  commandTip.visible = false
}

// 3x3 jog grid: row 0 = Y+, row 1 = X- | home | X+, row 2 = Y-
// Empty cells kept as nulls so the v-for stays declarative.
const jogGrid = computed(() => [
  { key: 'yn', label: 'Y+', gcode: () => `G91\nG1 Y${jog.value} F6000\nG90` },
  { key: 'yp', label: 'Y−', gcode: () => `G91\nG1 Y-${jog.value} F6000\nG90` },
  { key: 'xn', label: 'X−', gcode: () => `G91\nG1 X-${jog.value} F6000\nG90` },
  { key: 'home', label: '⌂', gcode: () => 'G28', home: true },
  { key: 'xp', label: 'X+', gcode: () => `G91\nG1 X${jog.value} F6000\nG90` },
])

// Range slider gradient stops
function fanGradient(value: number) {
  return `linear-gradient(90deg, var(--green), var(--green) ${value * 100}%, rgba(255,255,255,0.06) ${value * 100}%)`
}
function jogGradient(value: number) {
  const pct = ((value - 10) / 40) * 100
  return `linear-gradient(90deg, var(--green), var(--green) ${pct}%, rgba(255,255,255,0.06) ${pct}%)`
}
</script>

<template>
  <div class="card-panel h-full">
    <div class="t-title">Controls</div>

    <!-- Print controls -->
    <div class="flex flex-wrap items-center gap-2">
      <button v-if="printer.isPaused" class="btn btn-primary" @click="resumeJob">Resume</button>
      <button v-if="printer.isPrinting" class="btn btn-warn" @click="pauseJob">Pause</button>
      <button v-if="printer.isPrinting || printer.isPaused" class="btn" @click="cancelJob">Cancel</button>
      <span v-if="!printer.isPrinting && !printer.isPaused" class="t-mute uppercase tracking-wider">No active print</span>
      <button class="btn btn-danger ml-auto shrink-0" @click="stopPrinter">
        🚨 ABORT
      </button>
    </div>

    <div class="divider" />

    <!-- Jog + Temperature (side by side) -->
    <div class="grid grid-cols-2 max-sm:grid-cols-1 gap-8">
      <!-- Jog -->
      <div>
        <div class="flex items-center justify-between mb-5">
          <div class="t-title">Jog</div>
          <span v-if="jobActive" class="text-[10px] text-[var(--amber)] uppercase tracking-wider">Locked while printing</span>
        </div>
        <div class="flex items-center gap-3 mb-5">
          <span class="t-mute text-[11px] uppercase tracking-wider shrink-0">Distance</span>
          <input
            type="range"
            min="10" max="50" step="10"
            v-model.number="jog"
            :disabled="jobActive"
            class="flex-1 range-slider"
            :style="{ '--tw-accent': jogGradient(jog) }"
          />
          <span class="w-9 text-right font-mono text-[13px] text-[var(--text-dim)] tabular-nums">{{ jog }}mm</span>
        </div>
        <div class="flex flex-col items-center gap-4">
          <div class="grid grid-cols-3 gap-2.5 w-full max-w-[220px]">
            <div></div>
            <button class="jog-btn" :disabled="jobActive" @click="runIdleCommand(jogGrid[0].gcode())">{{ jogGrid[0].label }}</button>
            <div></div>
            <button class="jog-btn" :disabled="jobActive" @click="runIdleCommand(jogGrid[2].gcode())">{{ jogGrid[2].label }}</button>
            <button class="jog-btn jog-home" :disabled="jobActive" @click="runIdleCommand(jogGrid[3].gcode())">{{ jogGrid[3].label }}</button>
            <button class="jog-btn" :disabled="jobActive" @click="runIdleCommand(jogGrid[4].gcode())">{{ jogGrid[4].label }}</button>
            <div></div>
            <button class="jog-btn" :disabled="jobActive" @click="runIdleCommand(jogGrid[1].gcode())">{{ jogGrid[1].label }}</button>
            <div></div>
          </div>
          <div class="flex items-center gap-2.5">
            <button class="jog-btn px-7" :disabled="jobActive" @click="runIdleCommand(`G91\nG1 Z${jog} F1200\nG90`)">Z+</button>
            <button class="jog-btn px-7" :disabled="jobActive" @click="runIdleCommand(`G91\nG1 Z-${jog} F1200\nG90`)">Z−</button>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-ghost btn-sm" :disabled="jobActive" @click="runIdleCommand('G28 X Y')">Home XY</button>
            <button class="btn btn-ghost btn-sm" :disabled="jobActive" @click="runIdleCommand('G28 Z')">Home Z</button>
            <button class="btn btn-ghost btn-sm" :disabled="jobActive" @click="runIdleCommand('G28')">Home all</button>
          </div>
        </div>
      </div>

      <!-- Temperature -->
      <div>
        <div class="flex items-center justify-between mb-5">
          <div class="t-title">Temperature</div>
          <div class="flex items-center gap-3">
            <span v-if="jobActive" class="text-[10px] text-[var(--amber)] uppercase tracking-wider">Locked while printing</span>
            <button class="btn btn-warn btn-sm" :disabled="jobActive" @click="allOff()">All off</button>
          </div>
        </div>
        <div class="space-y-5">
          <div v-for="h in heaters" :key="h.label" class="flex items-center gap-4">
            <div class="flex-1">
              <div class="flex items-baseline gap-3 mb-2">
                <span class="t-title">{{ h.label }}</span>
                <span class="t-mono text-[12px]">{{ h.current.toFixed(1) }}°C</span>
              </div>
              <div class="flex items-center gap-2.5">
                <input v-model="h.model.value" type="number" class="input font-mono" :placeholder="String(h.defaultTarget)" :disabled="jobActive" />
                <span class="t-mute text-[12px]">°C</span>
              </div>
            </div>
            <button class="btn btn-primary btn-sm mt-6" :disabled="jobActive" @click="setTemp(h.heater, h.model.value)">Set</button>
          </div>
        </div>
      </div>
    </div>

    <div class="divider" />

    <!-- Fans + LED (side by side) -->
    <div class="grid grid-cols-2 max-sm:grid-cols-1 gap-8">
      <!-- Fans -->
      <div>
        <div class="t-title mb-5">Fans</div>
        <div class="space-y-4">
          <div v-for="(f, i) in fans" :key="f.label">
            <div class="flex items-baseline justify-between mb-2">
              <span class="t-title">{{ f.label }}</span>
              <span class="t-mono text-[13px]">{{ fanLabel(fanSliders[i]) }}</span>
            </div>
            <input
              type="range"
              min="0" max="1" step="0.05"
              v-model="fanSliders[i]"
              class="w-full range-slider"
              :style="{ '--tw-accent': fanGradient(fanSliders[i]) }"
              @change="setFan(f.type, fanSliders[i] * 100)"
            />
          </div>
        </div>
      </div>

      <!-- LED + Quick -->
      <div>
        <div class="t-title mb-5">Lights</div>
        <div class="flex items-center gap-4 mb-6">
          <span class="status-dot w-2.5 h-2.5" :class="printer.ledState ? 'bg-[var(--green)]' : 'bg-[var(--text-mute)]'"></span>
          <span class="text-[14px] font-medium uppercase tracking-wider" :class="printer.ledState ? 'text-[var(--green)]' : 'text-[var(--text-dim)]'">
            Chamber {{ printer.ledState ? 'ON' : 'OFF' }}
          </span>
          <button class="btn btn-sm ml-auto" :class="printer.ledState ? 'btn-primary' : ''" :disabled="ledBusy" @click="toggleLed()">
            {{ ledBusy ? 'Switching…' : `Turn ${printer.ledState ? 'off' : 'on'}` }}
          </button>
        </div>

        <div class="divider mb-5" />

        <div class="flex items-center justify-between mb-4">
          <div class="t-title">Utilities</div>
          <span v-if="jobActive" class="text-[10px] text-[var(--amber)] uppercase tracking-wider">Locked while printing</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="c in utilities"
            :key="c.gcode"
            class="inline-flex"
            @mouseenter="showCommandTip($event, c)"
            @mouseleave="hideCommandTip"
          >
            <button class="btn btn-sm" :disabled="jobActive" @click="runUtility(c)">{{ c.label }}</button>
          </span>
        </div>

        <div class="divider my-5" />

        <div class="flex items-center justify-between mb-4">
          <div class="t-title">Maintenance</div>
          <span v-if="jobActive" class="text-[10px] text-[var(--amber)] uppercase tracking-wider">Locked while printing</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="c in maintenanceCommands"
            :key="c.gcode"
            class="inline-flex"
            @mouseenter="showCommandTip($event, c)"
            @mouseleave="hideCommandTip"
          >
            <button
              class="btn btn-sm"
              :class="c.warning ? 'btn-warn' : ''"
              :disabled="jobActive"
              @click="runUtility(c)"
            >{{ c.label }}</button>
          </span>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="command-tip">
      <div
        v-if="commandTip.visible && commandTip.text"
        class="fixed z-[100] px-3 py-1.5 rounded-lg term-panel text-[12px] font-medium leading-snug whitespace-nowrap shadow-xl pointer-events-none"
        :style="{ top: `${commandTip.y}px`, left: `${commandTip.x}px`, transform: 'translateX(-50%)' }"
        role="tooltip"
      >{{ commandTip.text }}</div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.command-tip-enter-active, .command-tip-leave-active {
  transition: opacity 0.12s ease;
}
.command-tip-enter-from, .command-tip-leave-to {
  opacity: 0;
}
</style>
