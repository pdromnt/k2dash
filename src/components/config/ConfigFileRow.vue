<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { fmtSize } from '@/utils/format'

const props = withDefaults(defineProps<{
  path: string
  name: string
  size?: number
  selected?: boolean
  deleteDisabled?: boolean
  padClass: string
}>(), { size: 0 })
const emit = defineEmits<{ open: [path: string]; remove: [path: string] }>()

function remove() {
  if (!props.deleteDisabled) emit('remove', props.path)
}
</script>

<template>
  <div class="flex items-center group" :class="{ 'bg-[var(--green)]/10': selected }">
    <button
      type="button"
      class="flex-1 text-left py-2 text-[13px] group-hover:bg-white/[0.02] transition-colors min-w-0"
      :class="padClass"
      @click="emit('open', path)"
    >
      <span class="flex items-center gap-2">
        <AppIcon name="file" :size="16" />
        <span class="truncate font-medium">{{ name }}</span>
      </span>
      <span class="block t-mono text-[10px] mt-0.5 ml-[25px]">{{ fmtSize(size) }}</span>
    </button>
    <button
      type="button"
      class="shrink-0 flex items-center gap-1.5 mx-2 px-3 py-2 rounded-md border border-transparent text-[12px] font-medium text-[var(--text-mute)] transition-all"
      :class="deleteDisabled
        ? 'opacity-35 cursor-not-allowed'
        : 'hover:text-[var(--red)] hover:border-[rgba(224,85,85,0.35)] hover:bg-[rgba(224,85,85,0.1)]'"
      :disabled="deleteDisabled"
      :aria-label="`Delete ${name}`"
      :title="deleteDisabled ? 'Config changes are locked while busy or disconnected' : `Delete ${name}`"
      @click="remove"
    >
      <AppIcon name="trash" :size="16" />
      <span>Delete</span>
    </button>
  </div>
</template>
