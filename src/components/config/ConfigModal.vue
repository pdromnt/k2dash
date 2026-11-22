<script setup lang="ts">
import { ref, computed, reactive, onUnmounted, onMounted } from 'vue'
import {
  getConfigFiles,
  getConfigFile,
  saveConfigFile,
  deleteConfigFile,
} from '@/api/moonraker'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterStore } from '@/stores/printer'
import { errMsg, fmtSize, splitPath } from '@/utils/format'
import {
  confirmationDialog,
  requestConfirmation,
} from '@/composables/useConfirmDialog'
import ConfigEditor from './ConfigEditor.vue'
import ConfigFileRow from './ConfigFileRow.vue'
import { buildConfigTree } from './configTree'
import AppIcon from '@/components/ui/AppIcon.vue'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { usePrinterActionLock } from '@/composables/usePrinterActionLock'
import { usePrinterRestart } from '@/composables/usePrinterRestart'
import PrinterRestartNotice from '@/components/layout/PrinterRestartNotice.vue'
import {
  cleanConfigBackups,
  isPrinterConfigBackup,
  planConfigBackupCleanup,
  referencedConfigBackups,
  type ConfigFileEntry,
} from './configBackups'

const banner = useBannerStore()
const toast = useToastStore()
const printer = usePrinterStore()
const { printStarting } = usePrinterWs()
const actionLock = usePrinterActionLock()
const { blocked: restartBlocked, restart } = usePrinterRestart()

// Editing config and (more importantly) restarting Klipper mid-print is
// a great way to ruin a job. Block both buttons whenever a print is
// active (printing, preparing, or paused).
const jobActive = computed(() => printer.jobActive)

const show = ref(false)
// Two distinct views inside the modal: the file list, and the editor for
// a single file. Switching between them is how we avoid cramming both
// side-by-side on mobile.
const view = ref<'list' | 'editor'>('list')

const loading = ref(false)
const selected = ref('')
const saving = ref(false)
const changed = ref(false)
const newFileName = ref('')
const collapsed = ref<Set<string>>(new Set())
const rawFiles = ref<ConfigFileEntry[]>([])
const backups = computed(() => planConfigBackupCleanup(rawFiles.value))
const showBackups = ref(false)
const cleaning = ref(false)
const cleanedCount = ref(0)
const cleanupStatus = ref('')
const mutationsBlocked = computed(() => Boolean(actionLock.value) || cleaning.value || saving.value)

const editor = ref<InstanceType<typeof ConfigEditor>>()

// Tooltip refs — teleported to body so they escape the modal's
// overflow:hidden and stacking context. Positioned from the trigger
// button's bounding rect on hover.
const saveBtn = ref<HTMLButtonElement>()
const restartBtn = ref<HTMLButtonElement>()
const tip = reactive<{ text: string; visible: boolean; x: number; y: number }>({
  text: '',
  visible: false,
  x: 0,
  y: 0,
})
function showTip(btn: HTMLButtonElement | undefined, text: string) {
  if (!btn || !text) return
  const r = btn.getBoundingClientRect()
  tip.text = text
  tip.x = r.left + r.width / 2
  tip.y = r.bottom + 8
  tip.visible = true
}
function hideTip() {
  tip.visible = false
}
const showSaveTip = () => showTip(saveBtn.value, actionLock.value)
const showRestartTip = () => showTip(restartBtn.value, actionLock.value)

const tree = computed(() => buildConfigTree(
  rawFiles.value.filter((file) => !isPrinterConfigBackup(file.path)),
))
let listRequest = 0

async function toggle() {
  if (cleaning.value || saving.value) return
  if (show.value) {
    await leaveEditor('close')
    return
  }
  show.value = true
  await loadFiles()
}

function resetEditor() {
  hideTip()
  view.value = 'list'
  selected.value = ''
  changed.value = false
  newFileName.value = ''
}

async function leaveEditor(destination: 'close' | 'list') {
  if (cleaning.value || saving.value) return
  if (view.value === 'editor' && changed.value) {
    const discard = await requestConfirmation({
      title: 'Discard unsaved changes?',
      message: 'Your edits will be lost.',
      confirmLabel: 'Discard changes',
      tone: 'warning',
    })
    if (!discard || saving.value) return
  }
  if (destination === 'close') {
    listRequest++
    show.value = false
  }
  resetEditor()
}

function close() {
  return leaveEditor('close')
}

function cancel() {
  return leaveEditor('list')
}

async function loadFiles() {
  const request = ++listRequest
  loading.value = true
  try {
    const files = await getConfigFiles()
    if (request !== listRequest) return
    rawFiles.value = files
    collapsed.value = new Set(tree.value.filter((file) => file.isDir).map((file) => file.path))
  } catch (error) {
    if (request === listRequest) banner.show('Failed to load config files', errMsg(error))
  } finally {
    if (request === listRequest) loading.value = false
  }
}

function openFile(path: string) {
  if (cleaning.value) return
  resetEditor()
  selected.value = path
  view.value = 'editor'
}

function startNewFile() {
  if (!mutationsBlocked.value) openFile('')
}

function onEditorError(error: unknown) {
  banner.show('Failed to read config', errMsg(error))
  resetEditor()
}

async function save() {
  await saveFile()
}

async function saveAndRestart() {
  if (!selected.value || mutationsBlocked.value || restartBlocked.value) return
  const ok = await saveFile()
  if (!ok) return
  await restart('host')
}

async function saveFile(): Promise<boolean> {
  if (mutationsBlocked.value) return false
  const fp = selected.value || newFileName.value
  const doc = editor.value?.read()
  if (!fp || !changed.value || doc === undefined) return false
  saving.value = true
  try {
    await saveConfigFile(fp, doc)
    toast.show(`Saved ${fp}`)
    resetEditor()
    await loadFiles()
    return true
  } catch (e) {
    banner.show('Failed to save config', errMsg(e))
    return false
  } finally {
    saving.value = false
  }
}

async function delFile(p: string) {
  if (mutationsBlocked.value) return
  const filename = splitPath(p)
  const confirmed = await requestConfirmation({
    title: 'Delete config file?',
    message: 'This may break the printer configuration and cannot be undone.',
    subject: p,
    confirmLabel: 'Delete permanently',
    tone: 'danger',
    requiredText: filename,
  })
  if (!confirmed || mutationsBlocked.value) return
  try {
    await deleteConfigFile(p)
    toast.show(`Deleted ${p}`)
    if (selected.value === p) resetEditor()
    await loadFiles()
  } catch (e) {
    banner.show('Failed to delete config', errMsg(e))
  }
}

async function cleanupBackups() {
  if (mutationsBlocked.value || loading.value) return
  cleaning.value = true
  cleanedCount.value = 0
  cleanupStatus.value = 'Checking backup files…'
  try {
    const files = await getConfigFiles()
    const protectedPaths = await referencedConfigBackups(files, getConfigFile)
    const plan = planConfigBackupCleanup(files, protectedPaths)
    if (!plan.removable.length) {
      cleanupStatus.value = 'No older, unreferenced backups to delete.'
      return
    }
    const count = plan.removable.length
    const confirmed = await requestConfirmation({
      title: `Delete ${count} old config backup${count === 1 ? '' : 's'}?`,
      message:
        'Keeps the newest backup and any referenced by config includes. Active configuration files are not part of this cleanup. Deletion cannot be undone.',
      subject: plan.removable.map((file) => file.path).join('\n'),
      confirmLabel: `Delete ${count} backup${count === 1 ? '' : 's'}`,
      tone: 'danger',
      requiredText: 'DELETE BACKUPS',
    })
    if (!confirmed) {
      cleanupStatus.value = ''
      return
    }
    cleanupStatus.value = `Deleting 0 of ${count} backups…`
    const result = await cleanConfigBackups(plan.removable, {
      list: getConfigFiles,
      read: getConfigFile,
      remove: deleteConfigFile,
      allowed: () => !actionLock.value,
      progress: (n) => {
        cleanedCount.value = n
        cleanupStatus.value = `Deleting ${n} of ${count} backups…`
      },
    })
    cleanupStatus.value = `Deleted ${result.deleted.length} backup${result.deleted.length === 1 ? '' : 's'}.${result.skipped ? ` Skipped ${result.skipped} changed or protected files.` : ''}${result.stopped ? ` ${result.stopped}` : ''}`
    if (result.stopped)
      banner.show('Backup cleanup stopped', cleanupStatus.value)
    else toast.show(cleanupStatus.value)
  } catch (error) {
    cleanupStatus.value = `Cleanup stopped after deleting ${cleanedCount.value} backups. ${errMsg(error)}`
    banner.show('Could not clean up backups', cleanupStatus.value)
  } finally {
    await loadFiles()
    cleaning.value = false
  }
}

function toggleCollapse(p: string) {
  const s = collapsed.value
  if (s.has(p)) s.delete(p)
  else s.add(p)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && show.value && !confirmationDialog.open) close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  listRequest++
})
</script>

<template>
  <button class="btn" type="button" :disabled="cleaning" @click="toggle">
    Config
  </button>

  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-6 modal-container"
      >
        <!-- Backdrop: only dismisses from the file list, never while editing -->
        <div
          v-if="view === 'list'"
          class="absolute inset-0 bg-black/70 backdrop-blur-sm modal-backdrop"
          @click="close"
        ></div>
        <div
          v-else
          class="absolute inset-0 bg-black/70 modal-backdrop"
          aria-hidden="true"
        ></div>

        <Transition name="view">
          <!-- ── List view ── -->
          <div
            v-if="view === 'list'"
            key="list"
            class="relative flex flex-col w-full max-w-3xl h-[90vh] rounded-2xl card shadow-2xl overflow-hidden"
          >
            <div
              class="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0"
            >
              <div class="flex items-center gap-3">
                <div class="t-title">Config files</div>
                <span
                  v-if="!loading && tree.length > 0"
                  class="t-mute font-mono"
                  >{{ tree.length }} entries</span
                >
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]"
                  @click="loadFiles"
                  :disabled="loading || cleaning"
                  aria-label="Reload"
                  title="Reload"
                >
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
                <button
                  class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]"
                  :disabled="mutationsBlocked"
                  @click="startNewFile"
                  aria-label="New file"
                  title="New file"
                >
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
                <button
                  class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]"
                  :disabled="cleaning"
                  @click="close"
                  aria-label="Close"
                  title="Close"
                >
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <PrinterRestartNotice silent />
            <div class="flex-1 overflow-y-auto">
              <div v-if="loading" class="px-5 py-10 text-center">
                <span class="spinner spinner-sm"></span>
              </div>

              <template v-else>
                <template v-for="entry in tree" :key="entry.path">
                  <template v-if="entry.isDir">
                    <button
                      class="w-full flex items-center gap-2 px-5 py-2 text-[13px] font-medium text-[var(--text-dim)] hover:bg-white/[0.02] transition-colors"
                      @click="toggleCollapse(entry.path)"
                    >
                      <AppIcon
                        name="arrow"
                        :size="14"
                        :class="{ 'rotate-90': !collapsed.has(entry.path) }"
                      />
                      <AppIcon name="files" :size="16" />
                      <span class="truncate">{{ entry.name }}</span>
                    </button>
                    <template v-if="!collapsed.has(entry.path)">
                      <ConfigFileRow
                        v-for="sub in entry.children"
                        :key="sub.path"
                        :path="sub.path"
                        :name="sub.name"
                        :size="sub.size"
                        :selected="selected === sub.path"
                        :delete-disabled="mutationsBlocked"
                        pad-class="pl-12 pr-3"
                        @open="openFile"
                        @remove="delFile"
                      />
                    </template>
                  </template>

                  <ConfigFileRow
                    v-else
                    :path="entry.path"
                    :name="entry.name"
                    :size="entry.size"
                    :selected="selected === entry.path"
                    :delete-disabled="mutationsBlocked"
                    pad-class="px-5"
                    @open="openFile"
                    @remove="delFile"
                  />
                </template>
                <section
                  v-if="backups.backups.length"
                  class="config-backups"
                  aria-labelledby="config-backups-title"
                >
                  <div class="section-heading">
                    <h2 id="config-backups-title">
                      Config backups
                      <span class="count-label">{{
                        backups.backups.length
                      }}</span>
                    </h2>
                    <span class="unit-label">{{
                      fmtSize(
                        backups.backups.reduce(
                          (sum, file) => sum + file.size,
                          0,
                        ),
                      )
                    }}</span>
                  </div>
                  <p>
                    Timestamped snapshots, grouped out of your way. Cleanup
                    keeps the newest backup and protects files referenced by
                    config includes.
                  </p>
                  <div class="backup-actions">
                    <button
                      class="btn btn-sm"
                      :aria-expanded="showBackups"
                      aria-controls="config-backup-list"
                      @click="showBackups = !showBackups"
                    >
                      {{ showBackups ? 'Hide backups' : 'Show backups' }}
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      :disabled="mutationsBlocked || !backups.removable.length"
                      @click="cleanupBackups"
                    >
                      <AppIcon name="trash" :size="15" />{{
                        cleaning ? 'Cleaning…' : 'Clean up old backups'
                      }}
                    </button>
                  </div>
                  <p v-if="jobActive || printStarting" class="backup-lock">
                    Locked while printing
                  </p>
                  <p v-else-if="!printer.connected" class="backup-lock">
                    Printer disconnected
                  </p>
                  <div
                    v-show="showBackups"
                    id="config-backup-list"
                    class="backup-file-list"
                  >
                    <ConfigFileRow
                      v-for="file in backups.backups"
                      :key="file.path"
                      :path="file.path"
                      :name="file.path"
                      :size="file.size"
                      :selected="selected === file.path"
                      :delete-disabled="mutationsBlocked"
                      pad-class="px-0"
                      @open="openFile"
                      @remove="delFile"
                    />
                  </div>
                </section>
                <p v-if="cleanupStatus" class="backup-status" role="status">
                  {{ cleanupStatus }}
                </p>
              </template>
            </div>
          </div>

          <!-- ── Editor view ── -->
          <div
            v-else
            key="editor"
            class="relative flex flex-col w-full max-w-6xl h-[90vh] rounded-2xl card shadow-2xl overflow-hidden"
          >
            <div
              class="flex items-center justify-between shrink-0 px-4 py-3 border-b border-[var(--border)] gap-4"
            >
              <div class="flex items-center gap-3 min-w-0">
                <button
                  class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]"
                  @click="cancel"
                  aria-label="Back to files"
                  title="Back"
                >
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
                <div v-if="selected" class="text-[14px] font-medium truncate">
                  {{ selected }}
                </div>
                <div v-else class="flex items-center gap-2 min-w-0">
                  <span class="text-[14px] text-[var(--text-mute)] shrink-0"
                    >New file</span
                  >
                  <input
                    v-model="newFileName"
                    class="input !h-7 text-[12px] w-40"
                    placeholder="filename.cfg"
                  />
                </div>
                <span
                  v-if="changed"
                  class="text-[11px] text-[var(--amber)] uppercase tracking-wider shrink-0"
                  >Unsaved</span
                >
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="btn btn-sm" @click="cancel">Cancel</button>
                <button
                  v-if="selected"
                  ref="restartBtn"
                  class="btn btn-sm"
                  :disabled="!changed || mutationsBlocked || restartBlocked"
                  @mouseenter="showRestartTip"
                  @mouseleave="hideTip"
                  @click="saveAndRestart"
                >
                  Save + Restart
                </button>
                <button
                  ref="saveBtn"
                  class="btn btn-primary btn-sm"
                  :disabled="
                    !changed ||
                    mutationsBlocked ||
                    (!selected && !newFileName)
                  "
                  @mouseenter="showSaveTip"
                  @mouseleave="hideTip"
                  @click="save"
                >
                  {{ saving ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </div>

            <ConfigEditor
              v-if="show && view === 'editor'"
              :key="selected"
              ref="editor"
              :path="selected"
              @change="changed = true"
              @error="onEditorError"
            />
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <!-- Tooltips: teleported to body to escape the modal's overflow:hidden
       and stacking context. Positioned by getBoundingClientRect of the
       trigger button so they always sit just below it. -->
  <Teleport to="body">
    <Transition name="tip">
      <div
        v-if="tip.visible && tip.text"
        class="fixed z-[100] px-3 py-1.5 rounded-lg term-panel text-[12px] font-medium leading-snug whitespace-nowrap shadow-xl pointer-events-none"
        :style="{
          top: `${tip.y}px`,
          left: `${tip.x}px`,
          transform: 'translateX(-50%)',
        }"
        role="tooltip"
      >
        {{ tip.text }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.config-backups {
  margin: 12px 20px 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.config-backups > p,
.backup-status {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.65;
  margin-top: 10px;
}
.backup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.config-backups .backup-lock {
  color: var(--amber);
}
.backup-file-list {
  margin-top: 14px;
}
.backup-status {
  margin: 0 20px 20px;
}
@media (max-width: 480px) {
  .backup-actions {
    flex-direction: column;
  }
  .backup-actions .btn {
    min-height: 40px;
  }
}
/* Modal: fade the whole overlay in/out. */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active .modal-backdrop,
.modal-leave-active .modal-backdrop {
  transition: opacity 0.2s ease;
}
.modal-enter-from .modal-backdrop,
.modal-leave-to .modal-backdrop {
  opacity: 0;
}

/* View swap: slide the outgoing view left, the incoming view from the
   right. Both views are in the DOM during the transition; the new
   view sits on top so the slide reads as a horizontal page turn. */
.view-enter-active,
.view-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.view-leave-active {
  /* Outgoing view is absolute-positioned during its leave so the incoming
     view can sit on top of the same slot. */
  position: absolute;
  inset: 0;
}
.view-leave-to {
  transform: translateX(-24px);
  opacity: 0;
}
.view-enter-from {
  transform: translateX(24px);
  opacity: 0;
}

/* Tip: subtle fade so the tooltip doesn't pop in. */
.tip-enter-active,
.tip-leave-active {
  transition: opacity 0.12s ease;
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}
</style>
