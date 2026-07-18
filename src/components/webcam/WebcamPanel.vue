<script setup lang="ts">
import { onMounted } from 'vue'
import { useWebcam } from '@/composables/useWebcam'

const { videoRef, connected, connecting, error, connect, disconnect } = useWebcam()

onMounted(() => { if (import.meta.env.VITE_PRINTER_HOST) connect() })
</script>

<template>
  <div class="card-panel h-full">
    <div class="t-title">Webcam</div>

    <div class="relative grow min-h-[200px] bg-black rounded-lg overflow-hidden border border-[var(--border)]">
      <video ref="videoRef" class="w-full h-full object-contain" autoplay playsinline muted></video>
      <div v-if="connecting" class="absolute inset-0 flex items-center justify-center bg-black/60">
        <div class="text-center">
          <span class="spinner"></span>
          <p class="mt-3 t-mute uppercase tracking-wider">Connecting…</p>
        </div>
      </div>

      <div v-else-if="error" class="absolute inset-0 flex items-center justify-center bg-black/70 p-8 text-center">
        <div>
          <p class="text-[14px] text-[var(--text-dim)] mb-4">{{ error }}</p>
          <button class="btn btn-primary btn-sm" @click="connect">Retry</button>
        </div>
      </div>

      <div v-else-if="!connected" class="absolute inset-0 flex items-center justify-center text-[var(--text-mute)]">
        <div class="text-center">
          <svg class="w-10 h-10 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p class="t-mute uppercase tracking-wider">Idle</p>
        </div>
      </div>

    </div>

    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <span class="status-dot" :class="connected ? 'bg-[var(--green)]' : connecting ? 'bg-[var(--amber)] dot-pulse' : 'bg-[var(--text-mute)]'"></span>
        <span class="text-[13px] font-medium uppercase tracking-wider" :class="connected ? 'text-[var(--green)]' : connecting ? 'text-[var(--amber)]' : 'text-[var(--text-mute)]'">
          {{ connected ? 'Streaming' : connecting ? 'Connecting…' : 'Idle' }}
        </span>
      </div>
      <button v-if="!connected && !connecting" class="btn btn-primary btn-sm" @click="connect">Connect</button>
      <button v-else class="btn btn-sm" @click="disconnect">Stop</button>
    </div>
  </div>
</template>
