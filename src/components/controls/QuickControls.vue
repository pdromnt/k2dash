<script setup lang="ts">
import { ref, watch } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useBannerStore } from '@/stores/banner'
import { fanGcode, type CrealityFan } from '@/printer/crealityProtocol'
import AppIcon from '@/components/ui/AppIcon.vue'
const printer = usePrinterStore(),
  ws = usePrinterWs(),
  banner = useBannerStore()
const fans = [
  { name: 'Part', type: 'part' },
  { name: 'Case', type: 'case' },
  { name: 'Side', type: 'side' },
] satisfies Array<{ name: string; type: CrealityFan }>
const values = ref([0, 0, 0]),
  busy = ref(false)
watch(
  () => [printer.fanPart, printer.fanAux, printer.fanChamber],
  (v) => (values.value = v.map((x) => Math.round(x * 100))),
  { immediate: true },
)
async function fan(type: CrealityFan, i: number) {
  try {
    await ws.sendGcodeCommand(fanGcode(type, values.value[i]))
  } catch (e) {
    values.value = [printer.fanPart, printer.fanAux, printer.fanChamber].map(
      (v) => Math.round(v * 100),
    )
    banner.show(
      'Fan command failed',
      e instanceof Error ? e.message : undefined,
    )
  }
}
async function light() {
  if (busy.value) return
  busy.value = true
  try {
    await ws.setLight(!printer.ledState)
  } catch (e) {
    banner.show(
      'Light command failed',
      e instanceof Error ? e.message : undefined,
    )
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="inspector-section quick-controls">
    <div class="section-heading"><h2>Light & fans</h2></div>
    <div class="light-control">
      <AppIcon name="light" :size="18" /><span>Chamber light</span
      ><button
        class="switch"
        :class="{ 'switch-on': printer.ledState }"
        :disabled="!printer.connected || busy"
        role="switch"
        :aria-checked="printer.ledState"
        aria-label="Chamber light"
        @click="light"
      >
        <span />
      </button>
    </div>
    <div class="fan-controls">
      <label v-for="(f, i) in fans" :key="f.type"
        ><span
          >{{ f.name }}<b>{{ values[i] }}<small>%</small></b></span
        ><input
          v-model.number="values[i]"
          type="range"
          min="0"
          max="100"
          step="5"
          :disabled="!printer.connected"
          @change="fan(f.type, i)"
      /></label>
    </div>
  </section>
</template>
