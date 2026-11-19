<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useWebcam } from '@/composables/useWebcam'
import { usePrinterStore } from '@/stores/printer'
import { isPreview } from '@/utils/preview'
import AppIcon from '@/components/ui/AppIcon.vue'
const printer = usePrinterStore()
const { videoRef, connected, connecting, error, connect, disconnect } =
  useWebcam()
const expanded = ref(printer.isPrinting || printer.isPaused)
let attempted = false
function autoConnect() {
  if (!isPreview && printer.connected && expanded.value && !attempted) {
    attempted = true
    void connect()
  }
}
function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) {
    attempted = false
    autoConnect()
  } else {
    disconnect()
    attempted = false
  }
}
onMounted(autoConnect)
watch(() => printer.connected, autoConnect)
</script>
<template>
  <section class="camera-panel">
    <div class="section-heading">
      <h2><AppIcon name="camera" :size="17" />Camera</h2>
      <div class="camera-toolbar">
        <span v-if="connected" class="connection-state"
          ><span class="status-dot bg-current" />Streaming</span
        ><button
          class="btn"
          type="button"
          :aria-expanded="expanded"
          @click="toggle"
        >
          <AppIcon v-if="!expanded" name="play" :size="15" />
          {{ expanded ? 'Collapse' : 'Open camera' }}
        </button>
      </div>
    </div>
    <div v-if="expanded" class="camera-frame">
      <video
        v-if="!isPreview"
        ref="videoRef"
        autoplay
        playsinline
        muted
        aria-label="Live printer camera"
      />
      <div v-if="!connected" class="camera-idle">
        <span v-if="connecting" class="spinner" /><AppIcon
          v-else
          name="camera"
          :size="32"
        /><strong>{{
          isPreview
            ? 'Camera preview'
            : connecting
              ? 'Connecting to camera'
              : 'Camera stopped'
        }}</strong>
        <p>
          {{
            isPreview
              ? 'Preview mode does not connect to the printer camera.'
              : error || 'Open the camera to view the build plate.'
          }}
        </p>
        <button
          v-if="!connecting && !isPreview"
          class="btn"
          :disabled="!printer.connected"
          @click="connect"
        >
          {{ error ? 'Retry connection' : 'Connect' }}
        </button>
      </div>
    </div>
    <div v-if="connected || connecting" class="camera-footer">
      <span>Local WebRTC stream</span
      ><button class="btn" type="button" @click="disconnect">
        Stop stream
      </button>
    </div>
  </section>
</template>
