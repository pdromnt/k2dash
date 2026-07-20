<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { confirmationDialog, resolveConfirmation, resolveTextInput } from '@/composables/useConfirmDialog'

const enteredText = ref('')
const confirmationInput = ref<HTMLInputElement>()
const confirmationMatches = computed(() => (
  confirmationDialog.mode === 'text-input'
    ? enteredText.value.trim().length > 0
    : !confirmationDialog.requiredText || enteredText.value === confirmationDialog.requiredText
))

const confirmClass = computed(() => {
  if (confirmationDialog.tone === 'danger') return 'btn-danger'
  if (confirmationDialog.tone === 'warning') return 'btn-warn'
  return 'btn-primary'
})

watch(() => confirmationDialog.open, async (open) => {
  enteredText.value = confirmationDialog.initialValue
  if (open && (confirmationDialog.mode === 'text-input' || confirmationDialog.requiredText)) {
    await nextTick()
    confirmationInput.value?.focus()
    if (confirmationDialog.mode === 'text-input') confirmationInput.value?.select()
  }
})

function cancel() {
  if (confirmationDialog.mode === 'text-input') resolveTextInput(null)
  else resolveConfirmation(false)
}

function submit() {
  if (!confirmationMatches.value) return
  if (confirmationDialog.mode === 'text-input') resolveTextInput(enteredText.value)
  else resolveConfirmation(true)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div
        v-if="confirmationDialog.open"
        class="fixed inset-0 z-[110] flex items-center justify-center p-4"
        @keydown.esc="cancel"
      >
        <div class="absolute inset-0 bg-black/75 backdrop-blur-sm" @click="cancel" />
        <div
          class="relative z-10 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirmation-dialog-title"
        >
          <div id="confirmation-dialog-title" class="text-[16px] font-semibold text-[var(--text)]">
            {{ confirmationDialog.title }}
          </div>
          <p class="mt-3 text-[13px] leading-relaxed text-[var(--text-dim)]">
            {{ confirmationDialog.message }}
          </p>
          <div
            v-if="confirmationDialog.subject"
            class="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 font-mono text-[12px] text-[var(--text)] break-all"
          >{{ confirmationDialog.subject }}</div>
          <label v-if="confirmationDialog.requiredText || confirmationDialog.mode === 'text-input'" class="block mt-4">
            <span v-if="confirmationDialog.requiredText" class="block mb-2 text-[11px] uppercase tracking-wider text-[var(--text-mute)]">
              Type <strong class="font-mono text-[var(--text)] normal-case">{{ confirmationDialog.requiredText }}</strong> to confirm
            </span>
            <span v-else class="block mb-2 text-[11px] uppercase tracking-wider text-[var(--text-mute)]">
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
            <button class="btn btn-sm max-sm:w-full" @click="cancel">
              {{ confirmationDialog.cancelLabel }}
            </button>
            <button
              class="btn btn-sm max-sm:w-full"
              :class="confirmClass"
              :disabled="!confirmationMatches"
              @click="submit"
            >{{ confirmationDialog.confirmLabel }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
  transition: opacity 180ms ease;
}

.confirm-dialog-enter-from,
.confirm-dialog-leave-to {
  opacity: 0;
}
</style>
