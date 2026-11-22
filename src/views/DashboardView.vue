<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { workspacePages } from '@/workspacePages'
import { usePrinterStore } from '@/stores/printer'
import StatusPanel from '@/components/dashboard/StatusPanel.vue'
import ControlsPanel from '@/components/controls/ControlsPanel.vue'
import FilesPanel from '@/components/files/FilesPanel.vue'
import WebcamPanel from '@/components/webcam/WebcamPanel.vue'
import ConsolePanel from '@/components/console/ConsolePanel.vue'
import HistoryPanel from '@/components/activity/HistoryPanel.vue'
import FilamentPanel from '@/components/dashboard/FilamentPanel.vue'
import TimelapsePanel from '@/components/activity/TimelapsePanel.vue'
import QuickControls from '@/components/controls/QuickControls.vue'
import TemperaturePanel from '@/components/dashboard/TemperaturePanel.vue'
const route = useRoute()
const printer = usePrinterStore()
const active = computed(() => printer.jobActive)
const page = computed(() => workspacePages.find((item) => item.id === route.name))
</script>
<template>
  <div class="workspace-page">
    <Transition name="workspace-fade" mode="out-in">
      <div :key="route.name ?? route.path">
        <template v-if="route.name === 'overview'">
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
              <h1>{{ page?.heading }}</h1>
              <p>{{ page?.description }}</p>
            </div>
          </div>
          <FilesPanel v-if="route.name === 'files'" />
          <ControlsPanel v-else-if="route.name === 'controls'" />
          <div v-else-if="route.name === 'activity'" class="activity-grid">
            <HistoryPanel /><TimelapsePanel />
          </div>
          <ConsolePanel v-else-if="route.name === 'console'" />
        </template>
      </div>
    </Transition>
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

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .workspace-fade-enter-active {
    transition: opacity 170ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .workspace-fade-leave-active {
    transition: opacity 90ms ease-in;
    pointer-events: none;
  }

  .workspace-fade-enter-from,
  .workspace-fade-leave-to {
    opacity: 0;
  }
}
</style>
