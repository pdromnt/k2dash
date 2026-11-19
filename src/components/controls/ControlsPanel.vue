<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { requestConfirmation } from '@/composables/useConfirmDialog'
import QuickControls from './QuickControls.vue'
import BeltModuleCalibrationPreview from './BeltModuleCalibrationPreview.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
const printer = usePrinterStore()
const ws = usePrinterWs()
const banner = useBannerStore()
const toast = useToastStore()
const busy = ref(false)
const distance = ref(10)
const blocked = computed(
  () => printer.isPrinting || printer.isPaused || !printer.connected,
)
const lockReason = computed(() =>
  !printer.connected ? 'Printer disconnected' : 'Locked while printing',
)
const targets = reactive({ nozzle: '200', bed: '60', chamber: '0' })
const heaters = computed(() => [
  {
    id: 'nozzle' as const,
    label: 'Nozzle',
    code: 'M104',
    current: printer.extruderTemp,
  },
  { id: 'bed' as const, label: 'Bed', code: 'M140', current: printer.bedTemp },
  {
    id: 'chamber' as const,
    label: 'Chamber',
    code: 'M141',
    current: printer.chamberTemp,
  },
])
async function run(script: string, label: string) {
  if (blocked.value || busy.value) return
  busy.value = true
  try {
    await ws.sendGcodeCommand(script)
    toast.show(label + ' request sent')
  } catch (e) {
    banner.show(
      'Command could not be sent',
      e instanceof Error ? e.message : undefined,
    )
  } finally {
    busy.value = false
  }
}
async function temperature(h: (typeof heaters.value)[number]) {
  const target = Number(targets[h.id])
  if (!targets[h.id].trim() || !Number.isFinite(target) || target < 0) {
    banner.show('Invalid temperature', 'Enter a non-negative number.')
    return
  }
  await run(h.code + ' S' + target, h.label + ' temperature')
}
function jog(axis: string, sign: number) {
  return run(
    `G91\nG1 ${axis}${distance.value * sign} F${axis === 'Z' ? 1200 : 6000}\nG90`,
    axis + ' movement',
  )
}
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
    confirmation:
      'Load filament? The printer may heat the nozzle and move filament.',
  },
  {
    label: 'Unload filament',
    gcode: 'QUIT_MATERIAL',
    confirmation:
      'Unload filament? The printer may heat the nozzle, cut, and retract filament.',
  },
]

const maintenanceCommands: UtilityCommand[] = [
  {
    label: 'Bed leveling',
    gcode: 'G29',
    confirmation:
      'Run automatic bed leveling? This heats and moves the printer and may take several minutes.',
  },
  {
    label: 'Input shaping',
    gcode: 'INPUTSHAPER',
    confirmation:
      'Run input shaping calibration? The printer will home, move, vibrate, and save new calibration values.',
  },
  {
    label: 'Belt calibration',
    gcode: 'BELT_TENSION',
    confirmation:
      'Run belt calibration? Keep clear of the printer until it finishes.',
  },
  {
    label: 'Z calibration',
    gcode: 'Z_AXIS_CALIBRATION',
    confirmation:
      'Run Z-axis calibration? The printer will heat, home, clean the nozzle, and replace saved calibration values.',
  },
  {
    label: 'Nozzle PID',
    gcode: 'NOZZLE_PID',
    warning: 'ONLY USE THIS IF NECESSARY',
    confirmation:
      'Run nozzle PID calibration at 230°C and save the result? Only continue if recalibration is necessary.',
  },
  {
    label: 'Bed PID',
    gcode: 'BEDPID',
    warning: 'ONLY USE THIS IF NECESSARY',
    confirmation:
      'Run bed PID calibration at 100°C and save the result? Only continue if recalibration is necessary.',
  },
]

async function utility(command: UtilityCommand) {
  if (blocked.value || busy.value) return
  if (command.confirmation) {
    const confirmed = await requestConfirmation({
      title: command.label + '?',
      message: command.confirmation,
      confirmLabel: 'Run ' + command.label,
      tone: 'warning',
    })
    if (!confirmed || blocked.value) return
  }
  await run(command.gcode, command.label)
}
</script>
<template>
  <div class="controls-workspace">
    <div class="control-grid">
      <section class="control-section">
        <div class="section-heading">
          <h2>Movement</h2>
          <span v-if="blocked" class="lock-label">{{ lockReason }}</span>
        </div>
        <div class="control-section-body">
          <div class="distance-control">
            <label for="jog-distance">Move distance</label
            ><select
              id="jog-distance"
              v-model.number="distance"
              class="input"
              :disabled="blocked || busy"
            >
              <option v-for="d in [1, 5, 10, 25, 50]" :key="d" :value="d">
                {{ d }} mm
              </option>
            </select>
          </div>
          <div class="motion-controls">
            <div class="jog-pad">
              <span /><button
                class="jog-btn"
                :disabled="blocked || busy"
                @click="jog('Y', 1)"
              >
                Y+</button
              ><span /><button
                class="jog-btn"
                :disabled="blocked || busy"
                @click="jog('X', -1)"
              >
                X−</button
              ><button
                class="jog-btn home-button"
                :disabled="blocked || busy"
                aria-label="Home all axes"
                @click="run('G28', 'Home all axes')"
              >
                <AppIcon name="home" :size="19" /></button
              ><button
                class="jog-btn"
                :disabled="blocked || busy"
                @click="jog('X', 1)"
              >
                X+</button
              ><span /><button
                class="jog-btn"
                :disabled="blocked || busy"
                @click="jog('Y', -1)"
              >
                Y−</button
              ><span />
            </div>
            <div class="z-pad">
              <button
                class="jog-btn"
                :disabled="blocked || busy"
                @click="jog('Z', 1)"
              >
                Z+</button
              ><button
                class="jog-btn"
                :disabled="blocked || busy"
                @click="jog('Z', -1)"
              >
                Z−
              </button>
            </div>
          </div>
          <div class="homing-actions">
            <button
              class="btn btn-sm"
              :disabled="blocked || busy"
              @click="run('G28 X Y', 'Home X/Y')"
            >
              Home X/Y</button
            ><button
              class="btn btn-sm"
              :disabled="blocked || busy"
              @click="run('G28 Z', 'Home Z')"
            >
              Home Z
            </button>
          </div>
          <dl class="control-position">
            <div v-for="axis in ['x', 'y', 'z'] as const" :key="axis">
              <dt>{{ axis.toUpperCase() }}</dt>
              <dd>{{ printer.position[axis].toFixed(1) }} mm</dd>
            </div>
          </dl>
        </div>
      </section>
      <section class="control-section">
        <div class="section-heading">
          <h2>Heaters</h2>
          <span v-if="blocked" class="lock-label">{{ lockReason }}</span>
        </div>
        <div class="control-section-body">
          <form
            v-for="h in heaters"
            :key="h.id"
            class="heater-form"
            @submit.prevent="temperature(h)"
          >
            <label :for="'heater-' + h.id"
              >{{ h.label
              }}<span
                >{{ printer.connected ? h.current.toFixed(1) : '—' }}°C</span
              ></label
            >
            <div>
              <input
                :id="'heater-' + h.id"
                v-model="targets[h.id]"
                class="input"
                type="number"
                min="0"
                step="1"
                :disabled="blocked || busy"
              /><span>°C</span
              ><button class="btn btn-sm" :disabled="blocked || busy">
                Set
              </button>
            </div>
          </form>
          <button
            class="btn btn-warn all-heaters-off"
            :disabled="blocked || busy"
            @click="run('M104 S0\nM140 S0\nM141 S0', 'All heaters off')"
          >
            Turn all heaters off
          </button>
        </div>
      </section>
      <QuickControls />
    </div>
    <section class="control-section">
      <div class="section-heading">
        <h2>Filament & motors</h2>
        <span v-if="blocked" class="lock-label">{{ lockReason }}</span>
      </div>
      <div class="utility-grid">
        <button
          v-for="command in utilities"
          :key="command.gcode"
          class="btn"
          :disabled="blocked || busy"
          @click="utility(command)"
        >
          {{ command.label }}
        </button>
      </div>
    </section>
    <section class="control-section">
      <div class="section-heading">
        <h2>Maintenance</h2>
        <span v-if="blocked" class="lock-label">{{ lockReason }}</span>
      </div>
      <div class="maintenance-grid">
        <div
          v-for="command in maintenanceCommands"
          :key="command.gcode"
          class="utility-entry"
          :tabindex="command.warning ? 0 : undefined"
        >
          <button
            class="btn"
            :class="{ 'btn-warn': command.warning }"
            :disabled="blocked || busy"
            :aria-describedby="
              command.warning ? 'tip-' + command.gcode : undefined
            "
            @click="utility(command)"
          >
            {{ command.label }}</button
          ><span
            v-if="command.warning"
            :id="'tip-' + command.gcode"
            role="tooltip"
            class="utility-tooltip"
            >{{ command.warning }}</span
          >
        </div>
      </div>
      <p class="section-note">
        Calibration heats or moves the printer. Review the confirmation before
        continuing.
      </p>
      <BeltModuleCalibrationPreview />
    </section>
  </div>
</template>
