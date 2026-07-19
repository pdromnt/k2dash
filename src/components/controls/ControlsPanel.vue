<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { errMsg } from '@/utils/format'

const printer = usePrinterStore()
const banner = useBannerStore()
const toast = useToastStore()
const printerWs = usePrinterWs()

const jog = ref(10)
const fanSliders = ref([printer.fanPart, printer.fanAux, printer.fanChamber])
const ledBusy = ref(false)

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

async function setFan(pin: number, pct: number) {
  // CrealityPrint maps UI fans as part=P0, case=P2, auxiliary=P1.
  const crealityFan = [0, 2, 1][pin]
  await cmd(`M106 P${crealityFan} S${Math.round(pct * 2.55)}`, `Fan \u00b7 ${Math.round(pct)}%`)
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
  { label: 'Part' },
  { label: 'Case' },
  { label: 'Side' },
]

const quickCmds = [
  { label: 'Motors off', gcode: 'M84' },
  { label: 'Beep', gcode: 'M300' },
  { label: 'Fan off', gcode: 'M106 S0' },
  { label: 'Fan full', gcode: 'M106 S255' },
  { label: 'Reset extruder', gcode: 'G92 E0' },
  { label: 'Absolute position', gcode: 'G90' },
  { label: 'Relative position', gcode: 'G91' },
]

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
        <div class="t-title mb-5">Jog</div>
        <div class="flex items-center gap-3 mb-5">
          <span class="t-mute text-[11px] uppercase tracking-wider shrink-0">Distance</span>
          <input
            type="range"
            min="10" max="50" step="10"
            v-model.number="jog"
            class="flex-1 range-slider"
            :style="{ '--tw-accent': jogGradient(jog) }"
          />
          <span class="w-9 text-right font-mono text-[13px] text-[var(--text-dim)] tabular-nums">{{ jog }}mm</span>
        </div>
        <div class="flex flex-col items-center gap-4">
          <div class="grid grid-cols-3 gap-2.5 w-full max-w-[220px]">
            <div></div>
            <button class="jog-btn" @click="cmd(jogGrid[0].gcode())">{{ jogGrid[0].label }}</button>
            <div></div>
            <button class="jog-btn" @click="cmd(jogGrid[2].gcode())">{{ jogGrid[2].label }}</button>
            <button class="jog-btn jog-home" @click="cmd(jogGrid[3].gcode())">{{ jogGrid[3].label }}</button>
            <button class="jog-btn" @click="cmd(jogGrid[4].gcode())">{{ jogGrid[4].label }}</button>
            <div></div>
            <button class="jog-btn" @click="cmd(jogGrid[1].gcode())">{{ jogGrid[1].label }}</button>
            <div></div>
          </div>
          <div class="flex items-center gap-2.5">
            <button class="jog-btn px-7" @click="cmd(`G91\nG1 Z${jog} F1200\nG90`)">Z+</button>
            <button class="jog-btn px-7" @click="cmd(`G91\nG1 Z-${jog} F1200\nG90`)">Z−</button>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-ghost btn-sm" @click="cmd('G28 X Y')">Home XY</button>
            <button class="btn btn-ghost btn-sm" @click="cmd('G28 Z')">Home Z</button>
            <button class="btn btn-ghost btn-sm" @click="cmd('G28')">Home all</button>
          </div>
        </div>
      </div>

      <!-- Temperature -->
      <div>
        <div class="flex items-center justify-between mb-5">
          <div class="t-title">Temperature</div>
          <button class="btn btn-warn btn-sm" @click="allOff()">All off</button>
        </div>
        <div class="space-y-5">
          <div v-for="h in heaters" :key="h.label" class="flex items-center gap-4">
            <div class="flex-1">
              <div class="flex items-baseline gap-3 mb-2">
                <span class="t-title">{{ h.label }}</span>
                <span class="t-mono text-[12px]">{{ h.current.toFixed(1) }}°C</span>
              </div>
              <div class="flex items-center gap-2.5">
                <input v-model="h.model.value" type="number" class="input font-mono" :placeholder="String(h.defaultTarget)" />
                <span class="t-mute text-[12px]">°C</span>
              </div>
            </div>
            <button class="btn btn-primary btn-sm mt-6" @click="setTemp(h.heater, h.model.value)">Set</button>
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
              @change="setFan(i, fanSliders[i] * 100)"
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

        <div class="t-title mb-4">Quick commands</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in quickCmds"
            :key="c.gcode"
            class="btn btn-sm"
            :title="c.gcode"
            @click="cmd(c.gcode)"
          >
            {{ c.label }} <span class="ml-1 font-mono text-[var(--text-mute)]">{{ c.gcode }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
