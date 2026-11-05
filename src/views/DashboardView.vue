<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { usePrinterStore } from '@/stores/printer'
import StatusPanel from '@/components/dashboard/StatusPanel.vue'
import ControlsPanel from '@/components/controls/ControlsPanel.vue'
import FilesPanel from '@/components/files/FilesPanel.vue'
import WebcamPanel from '@/components/webcam/WebcamPanel.vue'
import ConsolePanel from '@/components/console/ConsolePanel.vue'
import HistoryPanel from '@/components/dashboard/HistoryPanel.vue'
import FilamentPanel from '@/components/dashboard/FilamentPanel.vue'
import TimelapsePanel from '@/components/dashboard/TimelapsePanel.vue'
import QuickControls from '@/components/controls/QuickControls.vue'
import TemperaturePanel from '@/components/dashboard/TemperaturePanel.vue'
const route = useRoute()
const printer = usePrinterStore()
const active = computed(() => printer.isPrinting || printer.isPaused)
const pages: Record<string, [string, string]> = {
  '/files': ['Files', 'G-code files stored on your printer.'],
  '/printer': ['Printer controls', 'Movement, heaters, and maintenance.'],
  '/activity': ['Activity', 'Print history and timelapse recordings.'],
  '/console': ['Console', 'Commands run on the printer immediately.'],
}
const page = computed(() => pages[route.path])
</script>
<template>
  <div class="workspace-page">
    <template v-if="route.path === '/'">
      <div class="overview-workspace">
        <div class="primary-workspace">
          <StatusPanel />
          <WebcamPanel v-if="active" />
          <FilesPanel v-else compact />
          <WebcamPanel v-if="!active" />
        </div>
        <aside class="inspector" aria-label="Printer readings and controls">
          <TemperaturePanel /><FilamentPanel /><QuickControls />
          <section class="position-readout">
            <h2>Position</h2>
            <dl>
              <div v-for="axis in ['x', 'y', 'z'] as const" :key="axis">
                <dt>{{ axis.toUpperCase() }}</dt>
                <dd>
                  {{
                    printer.connected ? printer.position[axis].toFixed(1) : '—'
                  }}<span>mm</span>
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </template>
    <template v-else>
      <div class="page-heading">
        <div>
          <h1>{{ page?.[0] }}</h1>
          <p>{{ page?.[1] }}</p>
        </div>
      </div>
      <FilesPanel v-if="route.path === '/files'" />
      <ControlsPanel v-else-if="route.path === '/printer'" />
      <div v-else-if="route.path === '/activity'" class="activity-grid">
        <HistoryPanel /><TimelapsePanel />
      </div>
      <ConsolePanel v-else-if="route.path === '/console'" />
    </template>
    <footer class="workspace-footer">
      <a
        href="https://github.com/pdromnt"
        target="_blank"
        rel="noopener noreferrer"
        >Created by @pdromnt</a
      ><a
        href="https://github.com/pdromnt/k2dash/blob/main/UNLICENSE"
        target="_blank"
        rel="noopener noreferrer"
        >The Unlicense</a
      >
    </footer>
  </div>
</template>
