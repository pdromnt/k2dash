<script setup lang="ts">
import { useToastStore } from '@/stores/toast'
import AppLayout from '@/components/layout/AppLayout.vue'

const toast = useToastStore()
</script>

<template>
  <AppLayout>
    <router-view />
  </AppLayout>

  <Teleport to="body">
    <div class="fixed bottom-8 right-8 z-[100] flex flex-col gap-3 w-[400px] max-w-[calc(100vw-3rem)]">
      <TransitionGroup name="toast">
        <div
          v-for="t in toast.toasts"
          :key="t.id"
          class="card p-5 shadow-2xl flex items-start gap-4"
        >
          <div
            class="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center border"
            style="background-color: color-mix(in srgb, var(--green) 12%, transparent); border-color: color-mix(in srgb, var(--green) 28%, transparent)"
          >
            <svg
              class="w-4 h-4"
              style="color: var(--green)"
              fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div class="flex-1 min-w-0 pt-0.5">
            <p
              class="text-[10px] font-semibold uppercase tracking-[0.14em] leading-none"
              style="color: var(--green)"
            >
              Success
            </p>
            <p class="text-[14px] text-[var(--text)] leading-snug mt-1.5">{{ t.message }}</p>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.toast-enter-from { opacity: 0; transform: translateY(8px); }
.toast-leave-to { opacity: 0; transform: scale(0.96); }
</style>
