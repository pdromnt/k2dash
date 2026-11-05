<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterStore } from '@/stores/printer'
import {
  getFileList,
  deleteFile,
  renameFile,
  type FileInfo,
} from '@/api/moonraker'
import { uploadFileKlipper4408 } from '@/api/creality'
import PrintDialog from './PrintDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { usePrinterWs } from '@/composables/usePrinterWs'
import {
  fmtSize,
  fmtDate,
  splitPath,
  replaceBasename,
  errMsg,
} from '@/utils/format'
import {
  requestConfirmation,
  requestTextInput,
} from '@/composables/useConfirmDialog'

const props = defineProps<{ compact?: boolean }>()
const banner = useBannerStore()
const toast = useToastStore()
const printer = usePrinterStore()
const printFile = ref<string | null>(null)
const search = ref('')
const visibleFiles = computed(() => {
  const list = files.value
    .filter((f) => f.path.toLowerCase().includes(search.value.toLowerCase()))
    .sort((a, b) =>
      sort.value === 'name'
        ? a.path.localeCompare(b.path)
        : b.modified - a.modified,
    )
  return props.compact ? list.slice(0, 4) : list
})

const printerWs = usePrinterWs()
const jobActive = computed(
  () => printer.isPrinting || printer.isPaused || !printer.connected,
)
const loadError = ref('')
const sort = ref('newest')
const ACTIONS_LOCKED_TIP =
  "Can't modify or start G-code files while a print is active"

const files = ref<FileInfo[]>([])
const uploading = ref(false)
const uploadProgress = ref(0)
const loading = ref(false)

const inp = ref<HTMLInputElement>()
const selectedFile = ref<File | null>(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    files.value = await getFileList()
  } catch (e) {
    loadError.value = errMsg(e) || 'Could not read files from the printer.'
  }
  loading.value = false
}

async function del(f: FileInfo) {
  if (jobActive.value) return
  const confirmed = await requestConfirmation({
    title: 'Delete G-code file?',
    message: 'This permanently removes the file from the printer.',
    subject: f.path,
    confirmLabel: 'Delete permanently',
    tone: 'danger',
  })
  if (!confirmed || jobActive.value) return
  try {
    await deleteFile(f.path)
    toast.show(`Deleted ${f.path}`)
    await load()
  } catch (e) {
    banner.show('Failed to delete file', errMsg(e))
  }
}

async function rename(f: FileInfo) {
  if (jobActive.value) return
  const currentName = splitPath(f.path)
  const entered = await requestTextInput({
    title: 'Rename G-code file',
    message:
      'Enter a new filename. Keep the G-code extension so the printer can recognize it.',
    inputLabel: 'Filename',
    initialValue: currentName,
    confirmLabel: 'Rename file',
  })
  if (entered === null || jobActive.value) return

  const newName = entered.trim()
  if (!newName || newName === currentName) return
  if (newName === '.' || newName === '..' || /[\\/:*?"<>|]/.test(newName)) {
    banner.show(
      'Invalid filename',
      'Use a filename without slashes or reserved characters.',
    )
    return
  }

  const destination = replaceBasename(f.path, newName)
  if (files.value.some((entry) => entry.path === destination)) {
    banner.show('Rename blocked', `${destination} already exists.`)
    return
  }

  try {
    await renameFile(f.path, destination)
    toast.show(`Renamed to ${newName}`)
    await load()
  } catch (e) {
    banner.show('Failed to rename file', errMsg(e))
  }
}

function pr(f: FileInfo) {
  if (jobActive.value || !printer.connected) return
  printFile.value = f.path
}

async function up() {
  if (jobActive.value || uploading.value) return
  const f = inp.value?.files?.[0]
  if (!f) return
  selectedFile.value = f
  uploading.value = true
  uploadProgress.value = 0
  try {
    await uploadFileKlipper4408(f, (p) => (uploadProgress.value = p))
    toast.show(`Uploaded ${f.name}`)
    uploadProgress.value = 100
    await load()
  } catch (e) {
    banner.show('Failed to upload file', errMsg(e))
  } finally {
    uploading.value = false
    if (inp.value) inp.value.value = ''
    selectedFile.value = null
  }
}

onMounted(load)
</script>
<template>
  <section class="files-panel" :class="{ 'files-compact': compact }">
    <div class="section-heading">
      <h2>
        {{ compact ? 'Files ready to print' : 'G-code files'
        }}<span v-if="!loading" class="count-label">{{ files.length }}</span>
      </h2>
      <div class="file-toolbar">
        <RouterLink v-if="compact" to="/files" class="btn btn-ghost btn-sm"
          >All files</RouterLink
        ><button
          class="btn btn-ghost btn-sm"
          :disabled="loading"
          aria-label="Refresh files"
          @click="load"
        >
          <AppIcon name="refresh" :size="16" />
        </button>
      </div>
    </div>
    <div v-if="!compact" class="file-tools">
      <label class="search-field"
        ><AppIcon name="search" :size="17" /><input
          v-model="search"
          type="search"
          placeholder="Search files"
          aria-label="Search files"
      /></label>
      <select v-model="sort" class="input sort-select" aria-label="Sort files">
        <option value="newest">Newest first</option>
        <option value="name">Name A–Z</option>
      </select>
      <label
        class="btn btn-primary upload-button"
        :class="{ 'is-disabled': jobActive || uploading }"
        ><AppIcon name="upload" :size="16" />{{
          uploading ? 'Uploading…' : 'Upload G-code'
        }}<input
          ref="inp"
          type="file"
          accept=".gcode,.g,.gco"
          class="sr-only"
          :disabled="jobActive || uploading"
          @change="up"
      /></label>
    </div>
    <div v-if="uploading" class="upload-progress">
      <span
        >{{ selectedFile?.name }}<strong>{{ uploadProgress }}%</strong></span
      ><progress
        class="progress"
        :value="uploadProgress"
        max="100"
        aria-label="Upload progress"
      />
    </div>
    <p v-if="printerWs.printStarting.value" class="inline-notice" role="status">
      Print request sent. Waiting for the printer to report its state.
    </p>
    <p v-else-if="jobActive && !compact" class="file-lock-note">
      {{
        printer.connected
          ? 'Print, rename, delete, and upload actions are locked during a print.'
          : 'Reconnect to the printer to modify files or start a job.'
      }}
    </p>
    <div v-if="loadError" class="panel-empty" role="alert">
      <AppIcon name="files" :size="26" /><strong>Could not load files</strong>
      <p>{{ loadError }}</p>
      <button class="btn btn-sm" @click="load">Retry</button>
    </div>
    <div
      v-else-if="loading"
      class="file-skeleton"
      aria-label="Loading files"
      role="status"
    >
      <div v-for="n in 3" :key="n"><span /><span /></div>
    </div>
    <div v-else-if="!files.length" class="panel-empty">
      <AppIcon name="files" :size="26" /><strong>No G-code files yet</strong>
      <p>Upload a sliced file to prepare a print.</p>
      <RouterLink v-if="compact" to="/files" class="btn btn-primary"
        >Upload a file</RouterLink
      >
    </div>
    <div v-else-if="!visibleFiles.length" class="panel-empty">
      <strong>No matching files</strong>
      <p>Try another filename or clear your search.</p>
      <button class="btn btn-sm" @click="search = ''">Clear search</button>
    </div>
    <ul v-else class="file-list">
      <li v-for="f in visibleFiles" :key="f.path">
        <span class="file-icon"><AppIcon name="file" :size="20" /></span>
        <div class="file-identity">
          <strong :title="f.path">{{ splitPath(f.path) }}</strong
          ><span
            >{{ fmtSize(f.size)
            }}<span v-if="!compact"> · {{ fmtDate(f.modified) }}</span></span
          >
        </div>
        <div class="file-actions">
          <button
            class="btn btn-sm"
            :disabled="jobActive || printerWs.printStarting.value"
            :title="jobActive ? ACTIONS_LOCKED_TIP : 'Set up this print'"
            @click="pr(f)"
          >
            <AppIcon name="play" :size="13" />Print</button
          ><template v-if="!compact"
            ><button
              class="btn btn-ghost btn-sm"
              :disabled="jobActive || !f.permissions.includes('w')"
              :title="jobActive ? ACTIONS_LOCKED_TIP : 'Rename file'"
              @click="rename(f)"
            >
              Rename</button
            ><button
              class="btn btn-ghost btn-sm destructive-action"
              :disabled="jobActive || !f.permissions.includes('w')"
              :title="jobActive ? ACTIONS_LOCKED_TIP : 'Delete file'"
              @click="del(f)"
            >
              <AppIcon name="trash" :size="15" /><span>Delete</span>
            </button></template
          >
        </div>
      </li>
    </ul>
    <PrintDialog v-if="printFile" :path="printFile" @close="printFile = null" />
  </section>
</template>
