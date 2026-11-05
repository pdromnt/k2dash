<script setup lang="ts">
import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import AppIcon from '@/components/ui/AppIcon.vue'
import { displayFilamentColor } from '@/printer/materialMapping'
const printer = usePrinterStore()
const slots = computed(() =>
  [...printer.cfsSlots].sort(
    (a, b) =>
      Number(a.isSpool) - Number(b.isSpool) ||
      a.boxId - b.boxId ||
      a.materialId - b.materialId,
  ),
)
</script>
<template>
  <section class="inspector-section materials-panel">
    <div class="section-heading">
      <h2>Materials</h2>
      <span class="unit-label">{{ printer.cfsName || 'CFS' }}</span>
    </div>
    <div v-if="slots.length" class="material-slots">
      <div
        v-for="s in slots"
        :key="s.boxId + '-' + s.materialId"
        class="material-slot"
        :class="{ 'material-slot-empty': !s.type, 'external-spool': s.isSpool }"
      >
        <span
          class="material-colour"
          :style="{ '--filament-color': displayFilamentColor(s.color) }"
        />
        <div>
          <strong
            >{{
              s.isSpool
                ? 'External spool'
                : s.boxId + String.fromCharCode(65 + s.materialId)
            }}<span>{{ s.type || 'Empty' }}</span></strong
          ><small :title="s.name || s.vendor">{{
            s.type
              ? s.name || s.vendor || 'Material loaded'
              : 'No material loaded'
          }}</small>
        </div>
      </div>
    </div>
    <div v-else class="inspector-empty">
      <AppIcon name="spool" :size="24" />
      <p>
        {{
          printer.connected
            ? 'No CFS materials reported. External spool printing is available in Files.'
            : 'Materials will appear after reconnection.'
        }}
      </p>
    </div>
    <div v-if="printer.cfsHumidity !== null" class="material-environment">
      <span
        >Humidity <strong>{{ printer.cfsHumidity }}%</strong></span
      ><span v-if="printer.cfsTemp !== null"
        >CFS <strong>{{ printer.cfsTemp }}°C</strong></span
      >
    </div>
  </section>
</template>
