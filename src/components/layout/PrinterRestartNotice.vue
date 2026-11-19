<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { dismissRestartNotice, isRestarting, restartNotice } from '@/composables/usePrinterRestart'

defineProps<{ silent?: boolean }>()
</script>

<template>
  <div class="shrink-0" :role="silent ? undefined : 'status'">
    <div v-if="restartNotice" class="connection-notice restart-notice">
      <AppIcon name="activity" :size="16" class="shrink-0" />
      <div class="min-w-0 flex-1 wrap-anywhere">
        <template v-if="isRestarting">
          <strong>Restarting Klipper…</strong>
          Creality may briefly show XS3000 (“System error, try restarting”). Wait for the printer to report Ready before rebooting it or starting a print.
        </template>
        <template v-else>
          <strong>Restart not confirmed.</strong>
          Check the printer display before trying again.
          <span v-if="restartNotice.detail">{{ restartNotice.detail }}</span>
        </template>
      </div>
      <button v-if="!isRestarting" class="btn btn-ghost" type="button" @click="dismissRestartNotice" aria-label="Dismiss restart notice">
        <AppIcon name="close" :size="16" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.restart-notice {
  align-items: start;
  font-size: 14px;
  line-height: 1.5;
}
.restart-notice > svg { margin-block-start: 3px; }
.restart-notice strong { font-weight: 650; }
.restart-notice button { min-width: 44px; min-height: 44px; }
</style>
