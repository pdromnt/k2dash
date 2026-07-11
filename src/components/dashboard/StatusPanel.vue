<script setup lang="ts">
import { usePrinterStore } from '@/stores/printer'
import { usePrinter } from '@/composables/usePrinter'
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { fmtDur, fmtFilamentMeters, printerError, splitPath } from '@/utils/format'

const printer = usePrinterStore()
usePrinter() // starts HTTP polling

const fmtTemp = (c: number) => (c > 0 ? `${c.toFixed(1)}°` : '—')

const estLeft = computed(() => {
  if (printer.printLeftTime > 0) return fmtDur(printer.printLeftTime)
  if (!printer.isPrinting || printer.totalLayers === 0 || printer.currentLayer === 0) return null
  return fmtDur(Math.round((printer.printDuration / printer.currentLayer) * (printer.totalLayers - printer.currentLayer)))
})
const elapsed = computed(() => fmtDur(printer.printDuration))

const showPill = ref(false)
let pillTimer: ReturnType<typeof setTimeout>
const dismiss = () => { showPill.value = false; clearTimeout(pillTimer) }

function togglePill() {
  if (showPill.value) { dismiss() }
  else { showPill.value = true; pillTimer = setTimeout(dismiss, 5000) }
}

// The K2 Plus firmware generates current_print_image.png lazily — at
// print start the WS fires the filename before the file is on disk,
// so the first fetch 404s. Retry once after a short delay; by then
// the file is in place. Single retry so a genuinely missing file
// (no print running) doesn't loop forever.
let thumbnailRetried = false
function onThumbnailError(e: Event) {
  if (thumbnailRetried) return
  thumbnailRetried = true
  setTimeout(() => {
    // Force a re-render by appending a unique cache-buster. The
    // browser's broken-image state clears on src reassignment.
    const img = e.target as HTMLImageElement
    const base = printer.thumbnailUrl.split('?')[0]
    img.src = `${base}?retry=${Date.now()}`
  }, 1500)
}
function resetThumbnailRetry() {
  thumbnailRetried = false
}

onMounted(() => document.addEventListener('click', dismiss))
onUnmounted(() => { document.removeEventListener('click', dismiss); clearTimeout(pillTimer) })

const rawFname = computed(() => splitPath(printer.printFilename))

// Reset the thumbnail retry guard when a new print starts so the next
// 404 (firmware hasn't written the file yet) can retry once again.
watch(rawFname, () => resetThumbnailRetry())

function tempColor(c: number, t: number) {
  if (t <= 0) return 'var(--text-mute)'
  const r = c / t
  if (r > 0.95) return 'var(--green)'
  if (r > 0.5) return 'var(--amber)'
  return 'var(--text-dim)'
}

const stateBadge = (s: string) => {
  if (s === 'printing' || s === 'preparing') return 'state-printing'
  if (s === 'paused') return 'state-paused'
  if (s === 'complete') return 'state-complete'
  if (s === 'error' || s === 'cancelled') return 'state-error'
  return 'state-idle'
}

const hasJob = computed(() => printer.isPrinting || printer.isPaused)

// Printer error: look up the code in our extracted translation map.
// Hidden if the user has dismissed THIS code (a new error re-shows).
const errorInfo = computed(() => printer.errorCode !== 0 ? printerError(printer.errorCode) : null)
const errorVisible = computed(() =>
  errorInfo.value !== null
  && printer.errorCode !== printer.dismissedErrorCode
)
function dismissError() {
  printer.dismissedErrorCode = printer.errorCode
}

// Three-way temperature column. Data-driven so the three rows stay in sync.
const heaters = computed(() => [
  { label: 'Extruder', current: printer.extruderTemp, target: printer.extruderTarget, muted: false },
  { label: 'Bed',      current: printer.bedTemp,      target: printer.bedTarget,      muted: false },
  { label: 'Chamber',  current: printer.chamberTemp,  target: printer.chamberTarget,  muted: true },
])
</script>

<template>
  <div class="card-panel h-full">
    <!-- Header -->
    <div class="flex items-center justify-between shrink-0 pb-5 max-sm:pb-4">
      <div class="t-title">Live status</div>
      <span v-if="hasJob && printer.state && printer.state !== 'unknown'" class="text-[11px] font-semibold uppercase tracking-wider capitalize" :class="stateBadge(printer.state)">
        {{ printer.state }}
      </span>
    </div>

    <!-- Error banner: shown when the K2 Plus reports a non-zero errcode.
         Lookup the code in our extracted translation map (see
         utils/printer-errors.json). The user can manually dismiss;
         a NEW error (different code) re-shows the banner. -->
    <div
      v-if="errorVisible"
      class="shrink-0 mb-4 px-4 py-2.5 rounded-lg bg-[rgba(224,85,85,0.12)] border border-[rgba(224,85,85,0.3)] text-[var(--red)]"
    >
      <div class="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider">
        <span class="status-dot bg-[var(--red)] shrink-0" style="width:6px;height:6px"></span>
        <span>
          Printer error
          <span v-if="errorInfo?.code" class="ml-1.5 opacity-80">· {{ errorInfo.code }}</span>
          <span v-else class="ml-1.5 opacity-80">· code {{ printer.errorCode }}</span>
        </span>
        <button
          class="ml-auto opacity-70 hover:opacity-100 transition-opacity p-1 -m-1"
          aria-label="Dismiss error"
          title="Dismiss"
          @click="dismissError"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="text-[12px] text-[var(--text-dim)] mt-1.5 break-words">
        {{ errorInfo?.message || printer.errorMessage || 'Unknown error — check the printer display.' }}
      </div>
      <a
        v-if="errorInfo?.wiki"
        :href="errorInfo.wiki"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-block mt-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--red)] underline"
      >Troubleshooting wiki →</a>
    </div>

    <div class="flex-1 flex flex-col justify-center gap-5 max-sm:gap-4 lg:gap-8">

    <!-- Temperatures: responsive grid -->
    <div class="stats-grid">
      <div v-for="(h, i) in heaters" :key="h.label" class="stat-cell" :class="{ 'max-sm:-mb-5': i === heaters.length - 1 }">
        <div class="t-title mb-3">{{ h.label }}</div>
        <div class="flex max-sm:flex-col max-sm:items-start items-baseline gap-1.5 max-sm:gap-0.5">
          <span class="text-[20px] sm:text-[28px] font-semibold tracking-tight tabular-nums"
            :class="h.muted ? 'text-[var(--text-dim)]' : ''"
            :style="h.muted ? undefined : { color: tempColor(h.current, h.target) }">
            {{ fmtTemp(h.current) }}<span class="text-[0.55em] align-super ml-px">C</span>
          </span>
          <span v-if="h.target > 0" class="t-mono text-[11px] max-sm:hidden"> / {{ h.target.toFixed(0) }}°C</span>
          <span v-if="h.target > 0" class="t-mute text-[10px] hidden max-sm:inline">→ {{ h.target.toFixed(0) }}°C</span>
        </div>
      </div>
    </div>

    <!-- Separator -->
    <div class="divider -mx-7 lg:-mx-8" />

    <!-- Print job info (shown whenever a job exists) -->
    <div v-if="hasJob" class="flex flex-col gap-5">
      <div class="flex max-sm:flex-col gap-5 items-center">
        <img
          v-if="printer.thumbnailUrl"
          :src="printer.thumbnailUrl"
          :key="printer.thumbnailUrl"
          :alt="rawFname || 'Print preview'"
          class="w-[11.2rem] h-[11.2rem] rounded-lg object-cover bg-[var(--bg-input)] border border-[var(--border)] shrink-0 transition-transform duration-200 sm:hover:scale-[2.5] sm:hover:z-30 sm:hover:shadow-2xl sm:hover:rounded-xl origin-left sm:cursor-pointer"
          @error="onThumbnailError"
        />
        <div class="flex-1 min-w-0 flex flex-col justify-center gap-5 max-sm:w-full">
          <div class="flex sm:items-end justify-between gap-6 max-sm:flex-col max-sm:gap-2">
            <div class="flex-1 min-w-0">
              <div class="t-title mb-2">Print job</div>
              <div class="relative">
                <div class="text-[16px] font-medium select-none cursor-pointer truncate" @click.stop="togglePill">{{ rawFname || 'Untitled job' }}</div>
                <div
                  class="absolute bottom-full left-0 mb-2 px-3 py-1.5 rounded-lg term-panel text-[13px] font-normal leading-snug whitespace-normal break-all max-w-[min(320px,calc(100vw-2.5rem))] shadow-xl z-40 transition-opacity duration-150"
                  :class="showPill ? 'opacity-100' : 'opacity-0 pointer-events-none'"
                >{{ rawFname }}</div>
              </div>
            </div>
            <div class="text-[36px] font-semibold tabular-nums leading-none" :class="printer.isPrinting ? 'text-[var(--green)]' : 'text-[var(--text-dim)]'">
              {{ printer.printProgress }}<span class="text-[18px] text-[var(--text-mute)] ml-0.5">%</span>
            </div>
          </div>

          <progress class="progress" :value="printer.printProgress" max="100"></progress>

          <div class="grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <div class="t-title">Elapsed</div>
              <div class="t-mono text-[14px] mt-1">{{ elapsed }}</div>
            </div>
            <div>
              <div class="t-title">Remaining</div>
              <div class="t-mono text-[14px] mt-1">{{ estLeft || '—' }}</div>
            </div>
            <div>
              <div class="t-title">Layer</div>
              <div class="t-mono text-[14px] mt-1">{{ printer.currentLayer || '—' }} / {{ printer.totalLayers || '—' }}</div>
            </div>
            <div>
              <div class="t-title">Est. filament</div>
              <div class="t-mono text-[14px] mt-1">
                <template v-if="printer.filamentEstimatedWeight > 0">{{ printer.filamentEstimatedWeight.toFixed(1) }}g</template>
                <template v-else-if="printer.filamentEstimated > 0">{{ fmtFilamentMeters(printer.filamentEstimated) }}</template>
                <template v-else>—</template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Position / Fan / Filament (always visible) -->
    <div class="stats-grid">
      <div class="stat-cell pt-7 lg:pt-8 max-sm:py-4">
        <div class="t-title mb-3">Position</div>
        <div class="space-y-1.5 t-mono text-[13px]">
          <div class="flex justify-between"><span class="text-[var(--red)]">X</span><span>{{ printer.position.x.toFixed(1) }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--green)]">Y</span><span>{{ printer.position.y.toFixed(1) }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--blue)]">Z</span><span>{{ printer.position.z.toFixed(2) }}</span></div>
        </div>
      </div>
      <div class="stat-cell pt-7 lg:pt-8 max-sm:py-4">
        <div class="t-title mb-3">Part fan</div>
        <div class="flex items-baseline gap-1">
          <span class="text-[24px] sm:text-[28px] font-semibold tabular-nums">{{ Math.round(printer.fanPart * 100) }}</span>
          <span class="t-mono text-[13px]">%</span>
        </div>
      </div>
      <div class="stat-cell pt-7 lg:pt-8 max-sm:py-4">
        <div class="t-title mb-3">Filament used</div>
        <div class="flex items-baseline gap-1">
          <span class="text-[24px] sm:text-[28px] font-semibold tabular-nums">{{ fmtFilamentMeters(printer.filamentUsed) }}</span>
          <span v-if="printer.filamentUsed > 0" class="t-mute text-[12px] ml-0.5">~{{ (printer.filamentUsed * 0.003).toFixed(1) }}g</span>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>
