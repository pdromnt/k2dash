<script setup lang="ts">
import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { displayFilamentColor } from '@/printer/materialMapping'
const printer = usePrinterStore()
const groups = computed(() =>
  !printer.connected
    ? []
    : [
        ...(printer.cfsConnected === false
          ? []
          : printer.cfsUnits.map((unit) => ({
              key: 'cfs-' + unit.id,
              label: 'CFS ' + unit.id,
              name: unit.name,
              slots: unit.slots,
              humidity: unit.humidity,
              temperature: unit.temperature,
            }))),
        ...(printer.spoolSlots.length
          ? [
              {
                key: 'external',
                label: 'External spool',
                name: '',
                slots: printer.spoolSlots,
                humidity: null,
                temperature: null,
              },
            ]
          : []),
      ],
)
</script>
<template>
  <section
    v-for="group in groups"
    :key="group.key"
    class="inspector-section materials-panel"
    :aria-label="group.label"
  >
    <div class="section-heading">
      <h2>{{ group.label }}</h2>
      <span v-if="group.name && group.name !== 'CFS'" class="unit-label">{{
        group.name
      }}</span>
    </div>
    <div v-if="group.slots.length" class="material-slots">
      <div
        v-for="slot in group.slots"
        :key="slot.boxId + ':' + slot.materialId"
        class="material-slot"
        :class="{
          'material-slot-empty': !slot.type,
          'external-spool': slot.isSpool,
        }"
      >
        <span
          class="material-colour"
          :style="{ '--filament-color': displayFilamentColor(slot.color) }"
        />
        <div>
          <strong
            >{{
              slot.isSpool
                ? 'Spool holder'
                : slot.boxId + String.fromCharCode(65 + slot.materialId)
            }}<span>{{ slot.type || 'Empty' }}</span></strong
          >
          <small :title="slot.name || slot.vendor">{{
            slot.type
              ? slot.name || slot.vendor || 'Material loaded'
              : 'No material loaded'
          }}</small>
        </div>
      </div>
    </div>
    <p v-else class="inspector-note">Slot data unavailable.</p>
    <div
      v-if="group.humidity !== null || group.temperature !== null"
      class="material-environment"
    >
      <span v-if="group.humidity !== null"
        >Humidity <strong>{{ group.humidity }}%</strong></span
      >
      <span v-if="group.temperature !== null"
        >Temperature <strong>{{ group.temperature }}°C</strong></span
      >
    </div>
  </section>
</template>
