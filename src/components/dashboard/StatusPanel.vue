<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { showXs3000AsRestart } from '@/composables/usePrinterRestart'
import {
  fmtDur,
  fmtFilamentMeters,
  printerError,
  splitPath,
} from '@/utils/format'
import PrintActions from '@/components/controls/PrintActions.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { estimateJobFilament } from '@/utils/filamentUsage'
const printer = usePrinterStore()
const active = computed(() => printer.isPrinting || printer.isPaused)
const filamentEstimate = computed(() =>
  estimateJobFilament(
    printer.filamentUsed,
    printer.filamentEstimated,
    printer.filamentEstimatedWeight,
  ),
)
const stateLabel = computed(() =>
  !printer.connected
    ? 'Printer disconnected'
    : printer.isError
      ? 'Printer needs attention'
      : printer.isPaused
        ? 'Print paused'
        : printer.state === 'preparing'
          ? 'Preparing print'
          : printer.isPrinting
            ? 'Printing'
            : 'Printer ready',
)
const remaining = computed(() =>
  printer.printLeftTime > 0
    ? fmtDur(printer.printLeftTime)
    : printer.currentLayer > 0 && printer.totalLayers > printer.currentLayer
      ? fmtDur(
          (printer.printDuration / printer.currentLayer) *
            (printer.totalLayers - printer.currentLayer),
        )
      : 'Calculating…',
)
const finishTime = computed(() =>
  printer.printLeftTime > 0
    ? new Date(Date.now() + printer.printLeftTime * 1000).toLocaleTimeString(
        [],
        { hour: '2-digit', minute: '2-digit' },
      )
    : null,
)
const errorInfo = computed(() => printerError(printer.errorCode))
const errorVisible = computed(
  () =>
    printer.errorCode !== 0 && printer.dismissedErrorCode !== printer.errorCode &&
    !(printer.errorCode === 3000 && showXs3000AsRestart.value),
)
const imageFailed = ref(false),
  imageAttempt = ref(0)
let retry: ReturnType<typeof setTimeout> | undefined
watch(
  () => printer.thumbnailUrl,
  () => {
    imageFailed.value = false
    imageAttempt.value = 0
    clearTimeout(retry)
  },
)
function imageError() {
  imageFailed.value = true
  clearTimeout(retry)
  if (imageAttempt.value++ > 0) return
  retry = setTimeout(() => (imageFailed.value = false), 2000)
}
onUnmounted(() => clearTimeout(retry))
</script>
<template>
  <section class="job-panel" :class="{ 'job-active': active }">
    <div v-if="errorVisible" class="printer-error" role="alert">
      <div>
        <strong>{{ errorInfo?.code || 'Printer error' }}</strong>
        <p>
          {{
            errorInfo?.message ||
            printer.errorMessage ||
            'Check the printer display for details.'
          }}
        </p>
        <a
          v-if="errorInfo?.wiki"
          :href="errorInfo.wiki"
          target="_blank"
          rel="noopener noreferrer"
          >Troubleshooting</a
        >
      </div>
      <button
        class="btn btn-ghost btn-sm"
        aria-label="Dismiss printer error"
        @click="printer.dismissedErrorCode = printer.errorCode"
      >
        Dismiss
      </button>
    </div>
    <div v-if="active" class="current-job">
      <div class="job-preview">
        <img
          v-if="printer.thumbnailUrl && !imageFailed"
          :src="printer.thumbnailUrl"
          alt="Current print preview"
          @error="imageError"
        /><AppIcon v-else name="files" :size="30" />
      </div>
      <div class="job-identity">
        <div class="job-state" :class="{ 'state-warning': printer.isPaused }">
          <span class="status-dot bg-current" />{{ stateLabel }}
        </div>
        <h1>
          {{ splitPath(printer.printFilename) || 'Loading file details…' }}
        </h1>
        <p>
          {{
            printer.isPaused
              ? 'Resume when the printer is ready.'
              : finishTime
                ? 'Estimated finish ' + finishTime
                : 'Reading print details from the printer'
          }}
        </p>
      </div>
      <PrintActions hide-emergency />
    </div>
    <div v-if="active" class="job-progress">
      <div class="progress-label">
        <span
          >Progress <strong>{{ printer.printProgress }}%</strong></span
        ><span>{{ remaining }} remaining</span>
      </div>
      <progress
        class="progress"
        :value="printer.printProgress"
        max="100"
        aria-label="Print progress"
      />
    </div>
    <dl v-if="active" class="job-metrics">
      <div>
        <dt>Elapsed</dt>
        <dd>{{ fmtDur(printer.printDuration) }}</dd>
      </div>
      <div>
        <dt>Layer</dt>
        <dd>
          {{ printer.currentLayer || '—'
          }}<span> / {{ printer.totalLayers || '—' }}</span>
        </dd>
      </div>
      <div class="job-filament">
        <dt>Filament used</dt>
        <dd>
          {{ printer.filamentUsed === null ? '—' : fmtFilamentMeters(printer.filamentUsed) }}
          <span v-if="filamentEstimate && filamentEstimate.usedGrams !== null">
            / ~{{ Math.round(filamentEstimate.usedGrams) }}&nbsp;g
          </span>
          <span v-if="filamentEstimate" class="job-filament-detail">
            <template v-if="filamentEstimate.remainingMm > 0">
              ~{{ fmtFilamentMeters(filamentEstimate.remainingMm) }}
              <template v-if="filamentEstimate.remainingGrams !== null">
                / ~{{ Math.round(filamentEstimate.remainingGrams) }}&nbsp;g
              </template>
              left
            </template>
            <template v-else>
              {{ (printer.filamentUsed ?? 0) > printer.filamentEstimated ? 'Over estimate' : 'Estimate reached' }}
            </template>
          </span>
        </dd>
      </div>
    </dl>
    <div v-else class="idle-status">
      <span class="idle-state-icon"
        ><AppIcon
          :name="printer.connected && !printer.isError ? 'check' : 'activity'"
          :size="23"
      /></span>
      <div>
        <h1>{{ stateLabel }}</h1>
        <p>
          {{
            !printer.connected
              ? 'The dashboard will reconnect automatically.'
              : printer.isError
                ? 'Resolve the printer error before starting another job.'
                : 'No active job. Select a file below or upload a new one.'
          }}
        </p>
      </div>
      <RouterLink to="/files" class="btn btn-primary"
        ><AppIcon name="files" :size="16" />Open files</RouterLink
      >
    </div>
  </section>
</template>
