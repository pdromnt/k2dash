<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePrinterStore, type TimelapseFile } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { fmtSize, fmtDate, fmtDur, splitPath } from '@/utils/format'
import { HOST } from '@/utils/env'

const printer = usePrinterStore()
const printerWs = usePrinterWs()
const banner = useBannerStore()
const toast = useToastStore()

const hasFiles = computed(() => printer.timelapseFiles.length > 0)
const refreshing = ref(false)
const viewing = ref<TimelapseFile | null>(null)
const downloading = ref<string | null>(null)

function videoFilename(f: TimelapseFile) {
  return f.videoname || splitPath(f.video)
}

function videoUrl(f: TimelapseFile) {
  return `http://${HOST}:80/downloads/video/${encodeURIComponent(videoFilename(f))}`
}

function displayName(f: TimelapseFile) {
  return videoFilename(f)
}

async function downloadTimelapse(f: TimelapseFile) {
  if (downloading.value) return
  downloading.value = f.video
  try {
    const response = await fetch(videoUrl(f))
    if (!response.ok) throw new Error(`Printer returned HTTP ${response.status}`)

    const objectUrl = globalThis.URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = videoFilename(f)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 1000)
  } catch (e) {
    banner.show('Failed to download timelapse', e instanceof Error ? e.message : undefined)
  } finally {
    downloading.value = null
  }
}

async function loadTimelapses(showFeedback: boolean) {
  if (refreshing.value) return
  if (!printerWs.connected) {
    if (showFeedback) banner.show('Printer not connected')
    return
  }
  refreshing.value = true
  try {
    await printerWs.refreshTimelapses()
    if (showFeedback) toast.show(`Refreshed timelapses (${printer.timelapseFiles.length})`)
  } catch (e) {
    banner.show('Failed to refresh timelapses', e instanceof Error ? e.message : undefined)
  } finally {
    refreshing.value = false
  }
}

function refresh() {
  return loadTimelapses(true)
}

// The panel normally mounts before the shared printer socket is ready.
// Load on its first connection (and after reconnects) instead of requiring
// the user to press Reload once the socket catches up.
watch(printerWs.connected, (isConnected, wasConnected) => {
  if (isConnected && !wasConnected) void loadTimelapses(false)
}, { immediate: true })

async function deleteTimelapse(f: TimelapseFile) {
  if (!confirm(`Delete ${displayName(f)}?`)) return
  try {
    await printerWs.deleteTimelapse(f.video)
    toast.show(`Deleted ${displayName(f)}`)
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
        <li v-for="f in printer.timelapseFiles" :key="f.video" class="px-7 lg:px-8 py-4 flex items-center gap-4 max-sm:flex-wrap list-row-hover group">
          <svg class="w-8 h-8 text-[var(--text-mute)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <div class="flex-1 min-w-0">
            <div class="row-title" :title="displayName(f)">{{ displayName(f) }}</div>
            <div class="row-meta">
              {{ fmtSize(f.size) }}<span v-if="f.starttime"> · {{ fmtDate(f.starttime) }}</span><span v-if="f.duration"> · {{ fmtDur(f.duration) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 max-sm:w-full max-sm:flex-col">
            <button class="btn btn-sm max-sm:w-full" @click="viewing = f">View</button>
            <button
              class="btn btn-sm max-sm:w-full"
              :disabled="downloading !== null"
              @click="downloadTimelapse(f)"
            >{{ downloading === f.video ? 'Downloading…' : 'Download' }}</button>
            <button class="btn btn-danger btn-sm max-sm:w-full" @click="deleteTimelapse(f)">Delete</button>
          </div>
        </li>
      </ul>
    </div>

    <div v-else class="py-4 text-center text-[var(--text-mute)] text-[13px]">
      <span class="t-mute uppercase tracking-wider">No timelapse files found</span>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="timelapse-modal">
      <div v-if="viewing" class="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-6">
        <div class="absolute inset-0 bg-black/75 backdrop-blur-sm" @click="viewing = null" />
        <div class="relative z-10 w-full max-w-5xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl">
          <div class="flex items-center gap-4 px-5 py-4 border-b border-[var(--border)]">
            <div class="flex-1 min-w-0">
              <div class="t-title">Timelapse preview</div>
              <div class="text-[12px] text-[var(--text-mute)] truncate mt-1">{{ displayName(viewing) }}</div>
            </div>
            <button class="btn btn-ghost btn-sm" aria-label="Close preview" @click="viewing = null">Close</button>
          </div>
          <div class="bg-black">
            <video
              :key="viewing.video"
              :src="videoUrl(viewing)"
              class="w-full max-h-[75vh] object-contain"
              controls
              autoplay
              playsinline
              preload="metadata"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.timelapse-modal-enter-active,
.timelapse-modal-leave-active {
  transition: opacity 180ms ease;
}

.timelapse-modal-enter-from,
.timelapse-modal-leave-to {
  opacity: 0;
}
</style>
