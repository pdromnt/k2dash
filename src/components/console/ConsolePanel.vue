<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useConsole } from '@/composables/useConsole'
import { usePrinterStore } from '@/stores/printer'

const { messages, connected, connect, sendCommand, clear } = useConsole()
const printer = usePrinterStore()

// Informational only — Fluidd/Mainsail keep the console enabled
// during prints because Klipper is explicitly designed to accept
// injected G-code mid-print (pause/resume, filament runout response,
// etc.). We surface the state as awareness, not a hard block.
const jobActive = computed(() => printer.isPrinting || printer.isPaused)

const input = ref('')
const history = ref<string[]>([])
const hi = ref(-1)
const el = ref<HTMLDivElement>()

function sb() {
  nextTick(() => {
    if (el.value) el.value.scrollTop = el.value.scrollHeight
  })
}

function send() {
  const c = input.value.trim()
  if (!c || !connected.value) return
  history.value.push(c)
  hi.value = history.value.length
  sendCommand(c)
  input.value = ''
  sb()
}

function kd(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    send()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (hi.value > 0) {
      hi.value--
      input.value = history.value[hi.value]
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (hi.value < history.value.length - 1) {
      hi.value++
      input.value = history.value[hi.value]
    } else {
      hi.value = history.value.length
      input.value = ''
    }
  }
}

watch(messages, sb, { deep: true })
onMounted(() => {
  if (import.meta.env.VITE_PRINTER_HOST) connect()
})
</script>

<template>
  <div class="card-panel min-h-[520px]">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="t-title">Console</div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <span
              class="status-dot"
              :class="connected ? 'bg-[var(--green)]' : 'bg-[var(--text-mute)]'"
            ></span>
            <span
              class="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-mute)]"
            >
              {{ connected ? 'Connected' : 'Disconnected' }}
            </span>
          </div>
          <span
            v-if="jobActive"
            class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded"
            :class="
              printer.isPrinting
                ? 'bg-[var(--green)]/15 text-[var(--green)]'
                : 'bg-[var(--amber)]/15 text-[var(--amber)]'
            "
          >
            {{ printer.isPrinting ? 'Printing' : 'Paused' }}
          </span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" @click="clear">Clear</button>
    </div>

    <!-- Terminal -->
    <div
      ref="el"
      class="h-[360px] min-h-0 term-panel p-5 overflow-y-auto font-mono text-[13px] leading-[1.7]"
    >
      <div
        v-for="m in messages"
        :key="m.id"
        class="flex items-start gap-3"
        :class="{
          'text-[var(--green)]': m.type === 'send',
          'text-[var(--text-dim)]': m.type === 'recv',
          'text-[var(--text-mute)] italic': m.type === 'system',
        }"
      >
        <span
          class="text-[var(--text-mute)] select-none shrink-0 w-3 text-right"
        >
          <template v-if="m.type === 'send'">&gt;</template>
          <template v-else-if="m.type === 'system'">#</template>
        </span>
        <span class="whitespace-pre-wrap break-words flex-1">{{ m.text }}</span>
      </div>
    </div>

    <!-- Input -->
    <div class="flex items-center gap-3 term-input px-5 py-3.5">
      <span
        class="text-[var(--green)] font-mono text-[14px] select-none shrink-0"
        >›</span
      >
      <input
        v-model="input"
        class="flex-1 bg-transparent border-0 outline-none font-mono text-[14px] text-[var(--text)] placeholder:text-[var(--text-mute)]"
        placeholder="Enter a G-code command…"
        aria-label="G-code command"
        @keydown="kd"
      />
      <button
        class="btn btn-primary btn-sm"
        :disabled="!input.trim() || !connected"
        @click="send"
      >
        Send
      </button>
    </div>
  </div>
</template>
