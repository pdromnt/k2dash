<script setup lang="ts">
import { ref } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { computed } from 'vue'
import { fmtSize, fmtDate, fmtDur } from '@/utils/format'
import { HOST } from '@/utils/env'

const printer = usePrinterStore()
const printerWs = usePrinterWs()
const banner = useBannerStore()
const toast = useToastStore()

const hasFiles = computed(() => printer.timelapseFiles.length > 0)
const refreshing = ref(false)

function downloadUrl(f: { video: string }) {
  // K2 Plus serves timelapses at /downloads/video/ on port 80 — same
  // path CrealityPrint uses. `f.video` is the bare filename returned
  // by the printer's elapseVideoList WS payload.
  return `http://${HOST}:80/downloads/video/${encodeURIComponent(f.video)}`
}

function displayName(f: { videoname?: string; video: string }) {
  return f.videoname || f.video
}

async function refresh() {
  if (refreshing.value) return
  if (!printerWs.connected) {
    banner.show('Printer not connected')
    return
  }
  refreshing.value = true
  try {
    await printerWs.refreshTimelapses()
    toast.show(`Refreshed timelapses (${printer.timelapseFiles.length})`)
  } catch (e) {
    banner.show('Failed to refresh timelapses', e instanceof Error ? e.message : undefined)
  } finally {
    refreshing.value = false
  }
}

async function deleteTimelapse(f: { video: string }) {
  if (!confirm(`Delete ${f.video}?`)) return
  try {
    await printerWs.deleteTimelapse(f.video)
    toast.show(`Deleted ${f.video}`)
  } catch (e) {
    banner.show('Failed to delete timelapse', e instanceof Error ? e.message : undefined)
  }
}
</script>

<template>
  <div class="card-panel">
    <div class="flex items-center justify-between">
      <div class="t-title">Timelapse</div>
      <div class="flex items-center gap-3">
        <span v-if="hasFiles" class="t-mute font-mono">{{ printer.timelapseFiles.length }} videos</span>
        <button class="btn btn-ghost btn-sm" @click="refresh" :disabled="refreshing" aria-label="Reload timelapses">
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': refreshing }" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="hasFiles" class="-mx-7 lg:-mx-8">
      <ul class="divide-y divide-[var(--border)]">
        <li v-for="f in printer.timelapseFiles" :key="f.video" class="px-7 lg:px-8 py-4 flex items-center gap-4 list-row-hover group">
          <svg class="w-8 h-8 text-[var(--text-mute)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <div class="flex-1 min-w-0">
            <div class="row-title" :title="displayName(f)">{{ displayName(f) }}</div>
            <div class="row-meta">
              {{ fmtSize(f.size) }}<span v-if="f.starttime"> · {{ fmtDate(f.starttime) }}</span><span v-if="f.duration"> · {{ fmtDur(f.duration) }}</span>
            </div>
          </div>
          <a :href="downloadUrl(f)" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Download</a>
          <button class="btn btn-danger btn-sm" @click="deleteTimelapse(f)">Delete</button>
        </li>
      </ul>
    </div>

    <div v-else class="py-4 text-center text-[var(--text-mute)] text-[13px]">
      <span class="t-mute uppercase tracking-wider">No timelapse files found</span>
    </div>
  </div>
</template>
