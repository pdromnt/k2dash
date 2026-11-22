<script setup lang="ts">
import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
const printer = usePrinterStore()
const heaters = computed(() => [
  {
    name: 'Nozzle',
    current: printer.extruderTemp,
    target: printer.extruderTarget,
  },
  { name: 'Bed', current: printer.bedTemp, target: printer.bedTarget },
  {
    name: 'Chamber',
    current: printer.chamberTemp,
    target: printer.chamberTarget,
  },
])
</script>
<template>
  <section class="inspector-section temperatures">
    <div class="section-heading">
      <h2>Temperatures</h2>
      <span class="unit-label">°C</span>
    </div>
    <dl>
      <div v-for="h in heaters" :key="h.name">
        <dt>
          <span
            class="temperature-marker"
            :class="{ 'is-heating': h.target > 0 }"
          />{{ h.name }}
        </dt>
        <dd>
          <strong>{{ printer.connected ? h.current.toFixed(1) : '—' }}</strong
          ><span>/ {{ h.target > 0 ? h.target.toFixed(0) : 'Off' }}</span>
        </dd>
      </div>
    </dl>
    <p class="inspector-note text-right">
      {{
        !printer.connected
          ? 'Waiting for live readings'
          : heaters.some((h) => h.target > 0)
            ? 'Current / target temperature'
            : 'All heaters are off'
      }}
    </p>
  </section>
</template>
