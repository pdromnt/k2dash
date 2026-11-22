import { defineStore } from 'pinia'
import { ref } from 'vue'

interface Toast {
  id: number
  message: string
}

const AUTO_DISMISS_MS = 2500

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function show(message: string) {
    clearTimeout(timer)
    // Replace the previous notification when several commands arrive together.
    toasts.value = [{ id: nextId++, message }]
    timer = setTimeout(() => {
      toasts.value = []
      timer = undefined
    }, AUTO_DISMISS_MS)
  }

  return { toasts, show }
})
