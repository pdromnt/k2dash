<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useToastStore } from '@/stores/toast'
import { useBannerStore } from '@/stores/banner'
import { requestConfirmation } from '@/composables/useConfirmDialog'
import AppIcon from '@/components/ui/AppIcon.vue'
defineProps<{ emergencyOnly?: boolean; hideEmergency?: boolean }>()
const printer = usePrinterStore(),
  ws = usePrinterWs(),
  toast = useToastStore(),
  banner = useBannerStore()
const busy = ref(false)
const active = computed(() => printer.isPrinting || printer.isPaused)
async function act(action: 'pause' | 'resume' | 'cancel' | 'stop') {
  if (busy.value || !printer.connected) return
  if (action === 'cancel' || action === 'stop') {
    const confirmed = await requestConfirmation({
      title: action === 'stop' ? 'Emergency stop?' : 'Cancel this print?',
      message:
        action === 'stop'
          ? 'Immediately halts the printer. A firmware restart will be required.'
          : 'The current print will stop and cannot be resumed.',
      confirmLabel: action === 'stop' ? 'Emergency stop' : 'Cancel print',
      tone: 'danger',
    })
    if (
      !confirmed ||
      !printer.connected ||
      (action === 'cancel' && !active.value)
    )
      return
  }
  busy.value = true
  try {
    await {
      pause: ws.pausePrint,
      resume: ws.resumePrint,
      cancel: ws.cancelPrint,
      stop: ws.emergencyStop,
    }[action]()
    toast.show(
      `${{ pause: 'Pause', resume: 'Resume', cancel: 'Cancel', stop: 'Emergency stop' }[action]} request sent`,
    )
  } catch (e) {
    banner.show(
      'Command could not be sent',
      e instanceof Error ? e.message : undefined,
    )
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="print-actions">
    <button
      v-if="active && !emergencyOnly"
      class="btn btn-primary"
      :disabled="busy || !printer.connected"
      @click="act(printer.isPaused ? 'resume' : 'pause')"
    >
      <AppIcon :name="printer.isPaused ? 'play' : 'pause'" :size="15" />{{
        printer.isPaused ? 'Resume' : 'Pause'
      }}
    </button>
    <button
      v-if="active && !emergencyOnly"
      class="btn"
      :disabled="busy || !printer.connected"
      @click="act('cancel')"
    >
      Cancel
    </button>
    <button
      v-if="!hideEmergency"
      class="btn btn-ghost stop-button"
      :disabled="busy || !printer.connected"
      @click="act('stop')"
      title="Immediately halt the printer"
      aria-label="Emergency stop"
    >
      <AppIcon name="block" :size="18" /><span class="action-label"
        >Emergency stop</span
      >
    </button>
  </div>
</template>
