<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  confirmationDialog,
  resolveConfirmation,
  resolveTextInput,
} from '@/composables/useConfirmDialog'

const enteredText = ref('')
const dialog = ref<HTMLDialogElement>()
const cancelButton = ref<HTMLButtonElement>()
const confirmationInput = ref<HTMLInputElement>()
const confirmationMatches = computed(() =>
  confirmationDialog.mode === 'text-input'
    ? enteredText.value.trim().length > 0
    : !confirmationDialog.requiredText ||
      enteredText.value === confirmationDialog.requiredText,
)

const confirmClass = computed(() => {
  if (confirmationDialog.tone === 'danger') return 'btn-danger'
  if (confirmationDialog.tone === 'warning') return 'btn-warn'
  return 'btn-primary'
})

watch(
  () => [confirmationDialog.open, confirmationDialog.requestId],
  async () => {
    enteredText.value = confirmationDialog.initialValue
    await nextTick()
    if (!confirmationDialog.open) {
      dialog.value?.close()
      return
    }
    if (!dialog.value?.open) dialog.value?.showModal()
    if (
      confirmationDialog.mode === 'text-input' ||
      confirmationDialog.requiredText
    ) {
      confirmationInput.value?.focus()
      if (confirmationDialog.mode === 'text-input')
        confirmationInput.value?.select()
    } else cancelButton.value?.focus()
  },
)

function onBackdropClick(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const rect = dialog.value.getBoundingClientRect()
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    cancel()
}

function trapFocus(event: KeyboardEvent) {
  const controls = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
    ) || [],
  )
  const first = controls[0],
    last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

function cancel() {
  if (confirmationDialog.mode === 'text-input') resolveTextInput(null)
  else resolveConfirmation(false)
}

function submit() {
  if (!confirmationMatches.value) return
  if (confirmationDialog.mode === 'text-input')
    resolveTextInput(enteredText.value)
  else resolveConfirmation(true)
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="confirmation-dialog rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-[var(--text)]"
      aria-labelledby="confirmation-dialog-title"
      aria-describedby="confirmation-dialog-message"
      @cancel.prevent="cancel"
      @close="confirmationDialog.open && cancel()"
      @click="onBackdropClick"
      @keydown.tab="trapFocus"
    >
      <div class="w-full">
        <div
          id="confirmation-dialog-title"
          class="text-[16px] font-semibold text-[var(--text)]"
        >
          {{ confirmationDialog.title }}
        </div>
        <p
          id="confirmation-dialog-message"
          class="mt-3 text-[13px] leading-relaxed text-[var(--text-dim)]"
        >
          {{ confirmationDialog.message }}
        </p>
        <div
          v-if="confirmationDialog.subject"
            class="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 font-mono text-[12px] text-[var(--text)] break-all"
        >
          {{ confirmationDialog.subject }}
        </div>
        <label
          v-if="
            confirmationDialog.requiredText ||
            confirmationDialog.mode === 'text-input'
          "
          class="block mt-4"
        >
          <span
            v-if="confirmationDialog.requiredText"
            class="block mb-2 text-[11px] uppercase tracking-wider text-[var(--text-mute)]"
          >
            Type
            <strong class="font-mono text-[var(--text)] normal-case">{{
              confirmationDialog.requiredText
            }}</strong>
            to confirm
          </span>
          <span
            v-else
            class="block mb-2 text-[11px] uppercase tracking-wider text-[var(--text-mute)]"
          >
            {{ confirmationDialog.inputLabel }}
          </span>
          <input
            ref="confirmationInput"
            v-model="enteredText"
            class="input w-full font-mono"
            autocomplete="off"
            spellcheck="false"
            :placeholder="confirmationDialog.placeholder"
            @keydown.enter.prevent="submit"
          />
        </label>
        <div class="mt-6 flex justify-end gap-2 max-sm:flex-col-reverse">
          <button
            ref="cancelButton"
            class="btn btn-sm max-sm:w-full"
            @click="cancel"
          >
            {{ confirmationDialog.cancelLabel }}
          </button>
          <button
            class="btn btn-sm max-sm:w-full"
            :class="confirmClass"
            :disabled="!confirmationMatches"
            @click="submit"
          >
            {{ confirmationDialog.confirmLabel }}
          </button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.confirmation-dialog {
  margin: auto;
  width: min(448px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow: auto;
}
.confirmation-dialog::backdrop {
  background: #06090dc9;
}
</style>
