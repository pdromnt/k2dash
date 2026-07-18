<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { clearHistory, deleteHistoryJob, getHistoryList, type HistoryJob } from '@/api/moonraker'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterStore } from '@/stores/printer'
import { fmtDur, fmtDate, fmtFilamentMeters, errMsg } from '@/utils/format'

const jobs = ref<HistoryJob[]>([])
const loading = ref(false)
const mutating = ref(false)
const banner = useBannerStore()
const toast = useToastStore()
const printer = usePrinterStore()
const historyHasActiveJob = computed(() => jobs.value.some((job) => job.status === 'in_progress'))
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const statusClass = (s: string) => {
  if (s === 'completed') return 'state-printing'
  if (s === 'in_progress') return 'text-[var(--text)]'
  if (s === 'cancelled') return 'state-paused'
  if (s === 'error') return 'state-error'
  return 'state-idle'
}

const fmtStatus = (s: string) => s.replace(/_/g, ' ')

async function load() {
  loading.value = true
  try {
    const d = await getHistoryList()
    jobs.value = d.jobs || []
  } catch (e) {
    banner.show('Failed to fetch history', errMsg(e))
  }
  loading.value = false
}

async function removeJob(job: HistoryJob) {
  if (job.status === 'in_progress') return
  if (!confirm(`Remove ${job.filename} from print history?`)) return
  mutating.value = true
  try {
    await deleteHistoryJob(job.job_id)
    toast.show('History entry removed')
    await load()
  } catch (e) {
    banner.show('Failed to remove history entry', errMsg(e))
  } finally {
    mutating.value = false
  }
}

async function removeAll() {
  if (!jobs.value.length || historyHasActiveJob.value) return
  if (!confirm('Clear all print history? This cannot be undone.')) return
  mutating.value = true
  try {
    await clearHistory()
    toast.show('Print history cleared')
    await load()
  } catch (e) {
    banner.show('Failed to clear history', errMsg(e))
  } finally {
    mutating.value = false
  }
}

onMounted(load)

// Refresh when a print transitions from active to done so an
// "in_progress" job updates to completed / cancelled / error without
// the user having to click Reload. Brief delay gives the printer a
// moment to finalise the history record.
watch(() => printer.state, (newState, oldState) => {
  const wasActive = oldState === 'printing' || oldState === 'preparing' || oldState === 'paused'
  const isInactive = newState === 'complete' || newState === 'cancelled'
    || newState === 'error' || newState === 'idle'
  if (wasActive && isInactive) {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      load()
    }, 2000)
  }
})

onUnmounted(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
})
</script>

<template>
  <div class="card-panel h-full">
    <div class="flex items-center justify-between">
      <div class="t-title">History</div>
      <div class="flex items-center gap-3">
        <span v-if="!loading && jobs.length > 0" class="t-mute font-mono">{{ jobs.length }} jobs</span>
        <button
          v-if="jobs.length > 0"
          class="btn btn-danger btn-sm"
          :disabled="loading || mutating || historyHasActiveJob"
          :title="historyHasActiveJob ? 'Wait for the active print to finish' : 'Clear all print history'"
          @click="removeAll"
        >Clear</button>
        <button class="btn btn-ghost btn-sm" @click="load" :disabled="loading" aria-label="Reload history">
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </div>

    <div class="max-h-[380px] -mx-7 lg:-mx-8 overflow-y-auto">
      <div v-if="loading" class="empty-state">
        <span class="spinner"></span>
        <p class="mt-3 t-mute">Loading…</p>
      </div>

      <div v-else-if="jobs.length === 0" class="empty-state">
        <p class="text-[13px]">No history yet</p>
      </div>

      <ul v-else class="divide-y divide-[var(--border)]">
        <li v-for="j in jobs" :key="j.job_id" class="px-7 lg:px-8 py-5 list-row-hover">
          <div class="flex items-center gap-4">
            <div class="flex-1 min-w-0">
              <div class="row-title" :title="j.filename">{{ j.filename }}</div>
              <div class="row-meta">
                {{ fmtDate(j.start_time) }} · {{ fmtDur(j.print_duration) }} · {{ fmtFilamentMeters(j.filament_used) }}
              </div>
            </div>
            <span class="text-[11px] font-semibold uppercase tracking-wider" :class="statusClass(j.status)">
              {{ fmtStatus(j.status) }}
            </span>
            <button
              class="btn btn-danger btn-sm"
              :disabled="mutating || j.status === 'in_progress'"
              :title="j.status === 'in_progress' ? 'Cannot remove an active job' : 'Remove history entry'"
              @click="removeJob(j)"
            >Delete</button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
