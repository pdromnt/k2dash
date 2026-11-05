<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  home: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
  search: 'm21 21-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 3 M18 18A8 8 0 0 1 5 15',
  upload: 'M12 16V3 m-4 4 4-4 4 4 M4 15v6h16v-6',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h5',
  trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  files: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z',
  printer: 'M6 8V3h12v5 M6 17H3V8h18v9h-3 M6 14h12v7H6z M17 11h1',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  console: 'm4 6 6 6-6 6 M13 18h7',
  arrow: 'M5 12h14 m-5-5 5 5-5 5',
  camera: 'M15 8H5v10h10z m0 3 6-3v10l-6-3',
  light: 'M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0l-1 2H9z',
  pause: 'M8 5v14 M16 5v14',
  play: 'm8 4 12 8-12 8z',
  stop: 'M6 6h12v12H6z',
  block: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M5.64 5.64l12.72 12.72',
  check: 'm5 12 4 4L19 6',
  spool:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
}
</script>
<template>
  <svg
    :width="size || 20"
    :height="size || 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.overview" />
  </svg>
</template>
