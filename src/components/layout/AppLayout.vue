<script setup lang="ts">
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { computed, onMounted, onUnmounted, ref, watch, defineAsyncComponent } from 'vue'
import { checkConnection } from '@/api/creality'
import AppBanner from '@/components/layout/AppBanner.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
const ConfigModal = defineAsyncComponent(() => import('@/components/config/ConfigModal.vue'))

const printer = usePrinterStore()
const printerHost = import.meta.env.VITE_PRINTER_HOST || ''
const printerWs = usePrinterWs()
const isDev = import.meta.env.DEV
const showOffline = ref(false)
const everConnected = ref(false)
const connectionBanner = ref('')
let offlineSince: number | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

const OFFLINE_AFTER_MS = 15_000
const RECONNECT_BANNER_AFTER_MS = 4_000
const TICK_MS = 1_000

// Dot + label color mirrors the same six-way state mapping the label
// uses. Exposed as a state-* class name so the template can bind via
// :class instead of an inline :style color.
const stateClass = computed(() => {
  if (showOffline.value) return 'state-idle'
  if (printer.isPrinting) return 'state-printing'
  if (printer.isPaused) return 'state-paused'
  if (printer.isError) return 'state-error'
  if (printer.connected) return 'state-connected'
  return 'state-idle'
})

const stateLabel = computed(() => {
  if (showOffline.value) return 'OFFLINE'
  // WS is primary — if it drops, we're reconnecting regardless of HTTP
  if (!printerWs.connected) return 'RECONNECTING'
  return printer.isPrinting ? 'PRINTING'
    : printer.isPaused ? 'PAUSED'
    : printer.isError ? 'ERROR'
    : printer.isReady ? 'READY'
    : printer.connected ? 'CONNECTED'
    : 'OFFLINE'
})

// Reactive connection monitoring — WS is the primary health signal
watch(() => printerWs.connected, (wsOk) => {
  if (wsOk) {
    showOffline.value = false
    offlineSince = null
    connectionBanner.value = ''
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
    if (!everConnected.value) everConnected.value = true
    return
  }

  if (offlineSince === null) {
    offlineSince = Date.now()
    if (!tickTimer) {
      tickTimer = setInterval(() => {
        if (offlineSince === null) return
        const secs = Math.round((Date.now() - offlineSince) / 1000)
        if (!everConnected.value && secs * 1000 > OFFLINE_AFTER_MS) showOffline.value = true
        if (everConnected.value && secs * 1000 > RECONNECT_BANNER_AFTER_MS) {
          connectionBanner.value = `Connection lost — reconnecting (${secs}s)`
        }
      }, TICK_MS)
    }
  }
}, { immediate: true })

onMounted(async () => {
  try {
    await checkConnection()
    printer.connected = true
  } catch {
    printer.connected = false
  }
  printerWs.connect()
})

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
  offlineSince = null
})
</script>

<template>
  <div class="app-shell flex flex-col bg-[var(--bg-page)]">
    <ConfirmDialog />
    <!-- ── Top bar ── -->
    <header class="shrink-0 h-16 px-6 lg:px-10 flex items-center justify-between border-b border-[var(--border)]">
      <div class="flex items-center gap-8">
        <div class="flex items-baseline leading-none">
          <span class="text-[16px] font-semibold tracking-tight text-[var(--green)]">K2</span><span class="text-[16px] font-semibold tracking-tight text-[var(--text-dim)]">Dash</span>
        </div>
        <div class="h-5 w-px bg-[var(--border-strong)]"></div>
        <div class="flex items-center gap-2.5">
          <span class="status-dot w-2 h-2 bg-current" :class="stateClass"></span>
          <span class="text-[13px] font-medium" :class="stateClass">{{ stateLabel }}</span>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <ConfigModal />
        <span
          v-if="isDev"
          class="text-[12px] font-mono text-[var(--text-mute)]"
        >
          {{ printerHost }}
        </span>
      </div>
    </header>

    <!-- ── Banners ── -->
    <AppBanner />
    <div v-if="connectionBanner" class="shrink-0 px-6 py-2.5 text-[13px] font-medium text-center banner-error">
      {{ connectionBanner }}
    </div>

    <!-- ── Offline screen ── -->
    <div v-if="showOffline" class="flex-1 flex items-center justify-center bg-[var(--bg-page)] p-10">
      <div class="text-center max-w-md">
        <div class="w-20 h-20 mx-auto mb-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center">
          <svg class="w-10 h-10 text-[var(--red)]/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 class="text-[22px] font-semibold text-[var(--text)] mb-3 tracking-tight">Couldn't connect to printer</h1>
        <p class="text-[14px] text-[var(--text-dim)] leading-relaxed">
          Make sure the printer is powered on and connected to the same network.
          Check that <code class="text-[var(--green)] text-[13px]">{{ printerHost || 'VITE_PRINTER_HOST' }}</code> is reachable.
        </p>
      </div>
    </div>

    <!-- ── Main content ── -->
    <main v-else class="flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
