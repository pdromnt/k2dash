<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { useToastStore } from '@/stores/toast'
import {
  displayFilamentColor,
  type PrintFilament,
  type PrintSource,
} from '@/printer/materialMapping'
import { splitPath } from '@/utils/format'
import AppIcon from '@/components/ui/AppIcon.vue'
const props = defineProps<{ path: string }>()
const emit = defineEmits<{ close: [] }>()
const printer = usePrinterStore(),
  ws = usePrinterWs(),
  toast = useToastStore()
const dialog = ref<HTMLDialogElement>(),
  loading = ref(true),
  busy = ref(false),
  error = ref('')
// CFS telemetry can arrive after this dialog opens. Missing slots must never
// silently select the external-spool start command.
const source = ref<'cfs' | 'spool'>('cfs')
const filaments = ref<PrintFilament[]>([]),
  selection = ref<Record<string, string>>({})
const slots = computed(() =>
  printer.cfsSlots.filter((s) => !s.isSpool && s.type),
)
const jobActive = computed(() => printer.isPrinting || printer.isPaused)
const ready = computed(
  () =>
    printer.connected &&
    !jobActive.value &&
    !ws.printStarting.value &&
    !busy.value &&
    (source.value === 'spool' ||
      (!loading.value &&
        filaments.value.length > 0 &&
        filaments.value.every((f) =>
          slots.value.some(
            (s) =>
              `${s.boxId}:${s.materialId}` === selection.value[f.id] &&
              s.type.toUpperCase() === f.type.toUpperCase(),
          ),
        ))),
)
async function load() {
  loading.value = true
  error.value = ''
  try {
    filaments.value = await ws.getPrintFilaments(props.path)
    for (const f of filaments.value) {
      const compatible = slots.value.filter(
        (s) => s.type.toUpperCase() === f.type.toUpperCase(),
      )
      const exact = compatible.filter(
        (s) =>
          displayFilamentColor(s.color).toUpperCase() === f.color.toUpperCase(),
      )
      const slot =
        exact.length === 1
          ? exact[0]
          : compatible.length === 1
            ? compatible[0]
            : undefined
      if (slot) selection.value[f.id] = `${slot.boxId}:${slot.materialId}`
    }
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Could not read filament requirements'
  } finally {
    loading.value = false
  }
}
async function start() {
  if (!ready.value) return
  busy.value = true
  error.value = ''
  try {
    const options: PrintSource =
      source.value === 'spool'
        ? { source: 'spool' }
        : {
            source: 'cfs',
            mappings: filaments.value.map((f) => {
              const slot = slots.value.find(
                (s) => `${s.boxId}:${s.materialId}` === selection.value[f.id],
              )!
              return {
                ...f,
                color: displayFilamentColor(slot.color),
                boxId: slot.boxId,
                materialId: slot.materialId,
              }
            }),
          }
    await ws.startPrint(props.path, options)
    toast.show('Print request sent. Waiting for printer status.')
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not start print'
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  dialog.value?.showModal()
  void load()
})
</script>
<template>
  <dialog
    ref="dialog"
    class="print-dialog"
    aria-labelledby="print-dialog-title"
    @close="emit('close')"
    @cancel="busy && $event.preventDefault()"
  >
    <form @submit.prevent="start">
      <div class="section-heading">
        <h2 id="print-dialog-title">Set up your print</h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="busy"
          aria-label="Close print setup"
          @click="emit('close')"
        >
          Close
        </button>
      </div>
      <p class="dialog-filename">{{ splitPath(path) }}</p>
      <fieldset class="source-choice">
        <legend>Where is your filament?</legend>
        <label :class="{ 'source-selected': source === 'cfs' }"
          ><input v-model="source" type="radio" value="cfs" /><AppIcon
            name="spool"
          /><span
            ><strong>CFS</strong
            ><small>Choose a slot for each filament</small></span
          ></label
        ><label :class="{ 'source-selected': source === 'spool' }"
          ><input v-model="source" type="radio" value="spool" /><AppIcon
            name="printer"
          /><span
            ><strong>External spool</strong
            ><small>Filament loaded on the spool holder</small></span
          ></label
        >
      </fieldset>
      <div v-if="source === 'cfs'" class="mapping-list">
        <p v-if="loading" class="section-description">
          <span class="spinner spinner-sm" /> Reading the file’s material
          requirements…
        </p>
        <div v-else-if="!filaments.length" class="inline-notice">
          The printer did not provide filament requirements for this file. CFS
          printing is blocked until they can be read.<button
            type="button"
            class="text-link"
            @click="load"
          >
            Try again
          </button>
        </div>
        <label v-for="f in filaments" :key="f.id" class="mapping-row"
          ><span
            class="material-swatch"
            :style="{ background: f.color }"
          /><span
            ><strong>{{ f.type }}</strong
            ><small>File filament {{ f.id }}</small></span
          ><select
            v-model="selection[f.id]"
            class="input"
            :aria-label="'CFS slot for ' + f.id"
          >
            <option :value="undefined">Choose slot…</option>
            <option
              v-for="s in slots"
              :key="s.boxId + ':' + s.materialId"
              :value="s.boxId + ':' + s.materialId"
              :disabled="s.type.toUpperCase() !== f.type.toUpperCase()"
            >
              {{ s.boxId + String.fromCharCode(65 + s.materialId) }} ·
              {{ s.type }} {{ s.name }}
            </option>
          </select></label
        >
      </div>
      <p v-else class="inline-notice">
        Make sure the correct material is loaded from the external spool before
        starting.
      </p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="jobActive" class="form-error">
        A print is already running. Wait until it finishes.
      </p>
      <div class="dialog-footer">
        <button
          type="button"
          class="btn"
          :disabled="busy"
          @click="emit('close')"
        >
          Back to files</button
        ><button class="btn btn-primary" :disabled="!ready">
          <AppIcon name="play" :size="15" />{{
            busy ? 'Sending…' : 'Start print'
          }}
        </button>
      </div>
    </form>
  </dialog>
</template>
