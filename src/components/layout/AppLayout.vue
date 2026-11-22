<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { usePrintThumbnail } from '@/composables/usePrintThumbnail'
import { useIosStandaloneViewport } from '@/composables/useIosStandaloneViewport'
import { isPreview, previewState } from '@/utils/preview'
import AppBanner from './AppBanner.vue'
import PrinterRestartNotice from './PrinterRestartNotice.vue'
import { restartNotice } from '@/composables/usePrinterRestart'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { workspacePages } from '@/workspacePages'
import PrintActions from '@/components/controls/PrintActions.vue'
const ConfigModal = defineAsyncComponent(
  () => import('@/components/config/ConfigModal.vue'),
)
const printer = usePrinterStore()
const printerWs = usePrinterWs()
const standaloneViewport = useIosStandaloneViewport()
usePrintThumbnail()
const status = computed(() =>
  !printer.connected
    ? 'Disconnected'
    : printer.isPaused
      ? 'Paused'
      : printer.isPrinting
        ? 'Printing'
        : printer.isError
          ? 'Needs attention'
          : 'Ready',
)
onMounted(() => printerWs.connect())
function previewUrl(state: string) {
  return `${window.location.pathname}?preview=${state}${window.location.hash}`
}
</script>
<template>
  <div
    class="app-shell"
    :class="{ 'app-shell-standalone': standaloneViewport }"
    :style="standaloneViewport ? {
      '--ios-standalone-height': `${standaloneViewport.height}px`,
      '--ios-standalone-top': `${standaloneViewport.top}px`,
    } : undefined"
  >
    <a class="skip-link" href="#main-content">Skip to content</a>
    <ConfirmDialog />
    <header class="app-header">
      <RouterLink to="/" class="app-brand" aria-label="K2Dash overview"
        ><img src="/k2dash.svg" width="26" height="26" alt="" /><span
          >K2<strong>Dash</strong></span
        ></RouterLink
      >
      <span class="header-divider" />
      <span class="machine-name">{{ printer.modelName }}</span>
      <div class="header-actions">
        <span
          class="connection-state"
          :class="{
            'state-warning': !printer.connected || printer.isPaused,
            'state-error': printer.connected && printer.isError,
          }"
          ><span class="status-dot bg-current" />{{ status }}</span
        ><ConfigModal /><PrintActions emergency-only />
      </div>
    </header>
    <nav class="app-navigation" aria-label="Main navigation">
      <RouterLink
        v-for="item in workspacePages"
        :key="item.path"
        :to="item.path"
        :class="{ 'nav-active': $route.path === item.path }"
        ><AppIcon :name="item.icon" :size="17" /><span>{{
          item.label
        }}</span></RouterLink
      ><a
        class="nav-source"
        href="https://github.com/pdromnt/k2dash"
        target="_blank"
        rel="noopener noreferrer"
        >GitHub</a
      >
    </nav>
    <div v-if="isPreview" class="preview-strip">
      <strong>Preview</strong
      ><span>Sample data. Printer actions disabled.</span>
      <div>
        <a
          v-for="state in [
            'idle',
            'printing',
            'paused',
            'offline',
            'empty',
            'multi-cfs',
            'spool-only',
            'empty-cfs',
          ]"
          :key="state"
          :href="previewUrl(state)"
          :aria-current="previewState === state ? 'page' : undefined"
          >{{ state }}</a
        >
      </div>
    </div>
    <AppBanner />
    <PrinterRestartNotice />
    <div v-if="!printer.connected && !restartNotice" class="connection-notice" role="status">
      <AppIcon name="activity" :size="16" />Reconnecting to the printer.
      Readings are unavailable or may be out of date.
    </div>
    <main id="main-content" class="app-content"><slot /></main>
  </div>
</template>
