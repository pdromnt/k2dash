<script setup lang="ts">
import StatusPanel from '@/components/dashboard/StatusPanel.vue'
import ControlsPanel from '@/components/controls/ControlsPanel.vue'
import FilesPanel from '@/components/files/FilesPanel.vue'
import WebcamPanel from '@/components/webcam/WebcamPanel.vue'
import ConsolePanel from '@/components/console/ConsolePanel.vue'
import HistoryPanel from '@/components/dashboard/HistoryPanel.vue'
import FilamentPanel from '@/components/dashboard/FilamentPanel.vue'
import TimelapsePanel from '@/components/dashboard/TimelapsePanel.vue'
</script>

<template>
  <div class="max-w-[1800px] mx-auto px-8 lg:px-12 py-10 lg:py-14">
    <!-- Row 1: Status + Webcam -->
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8 mb-8 lg:mb-12">
      <div class="xl:col-span-6"><StatusPanel /></div>
      <div class="xl:col-span-6"><WebcamPanel /></div>
    </div>

    <!-- Row 2: Filaments -->
    <div class="mb-8 lg:mb-12">
      <FilamentPanel />
    </div>

    <!-- Row 3: Controls + Files -->
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8 mb-8 lg:mb-12">
      <div class="xl:col-span-7"><ControlsPanel /></div>
      <div class="xl:col-span-5"><FilesPanel /></div>
    </div>

    <!-- Row 4: Console + History -->
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8 mb-8 lg:mb-12">
      <div class="xl:col-span-7"><ConsolePanel /></div>
      <div class="xl:col-span-5"><HistoryPanel /></div>
    </div>

    <!-- Row 5: Timelapse -->
    <div>
      <TimelapsePanel />
    </div>

    <footer class="flex justify-center pt-10 lg:pt-14">
      <div class="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-[11px] text-[var(--text-mute)] shadow-sm">
        <span>Crafted by</span>
        <a
          href="https://github.com/pdromnt"
          target="_blank"
          rel="noopener noreferrer"
          class="font-semibold text-[var(--text-dim)] hover:text-[var(--green)] transition-colors"
        >@pdromnt</a>
        <span class="text-[var(--border-strong)]">•</span>
        <a
          href="https://github.com/pdromnt/k2dash"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 font-medium text-[var(--text-dim)] hover:text-[var(--green)] transition-colors"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .7a11.5 11.5 0 00-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.98 10.98 0 015.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0012 .7z" />
          </svg>
          <span>Source</span>
        </a>
      </div>
    </footer>
  </div>
</template>
