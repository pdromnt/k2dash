<script setup lang="ts">
import { ref, computed, reactive, h, defineComponent, nextTick, watch, onUnmounted, onMounted } from 'vue'
import { getConfigFiles, getConfigFile, saveConfigFile, deleteConfigFile, restartKlipper } from '@/api/moonraker'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterStore } from '@/stores/printer'
import { errMsg, fmtSize, splitPath } from '@/utils/format'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const klipperConfig = StreamLanguage.define({
  token(stream) {
    if (stream.sol() && stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }

    if (stream.match('{%')) {
      stream.eatWhile(c => c !== '%')
      if (!stream.match('%}')) stream.skipToEnd()
      return 'typeName'
    }

    if (stream.match('{{')) {
      stream.eatWhile(c => c !== '}')
      if (!stream.match('}}')) stream.skipToEnd()
      return 'string'
    }

    if (stream.sol() && stream.match('[')) {
      stream.eatWhile(/[^\]]/)
      stream.eat(']')
      return 'keyword'
    }

    if (stream.match(/^\d+\.?\d*/)) {
      return 'number'
    }

    if (stream.match(/"[^"]*"/)) {
      return 'string'
    }

    if (stream.match(/^[A-Z][A-Z0-9_]+(\s*\()?/)) {
      return 'atom'
    }

    if (stream.match(/^[a-zA-Z_][\w_]*\s*[:=]/)) {
      return 'variableName'
    }

    if (stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }

    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '#' } },
})

const banner = useBannerStore()
const toast = useToastStore()
const printer = usePrinterStore()

const UNSAVED_PROMPT = 'Discard unsaved changes?'

// One row in the file tree. Extracted so sub-entry (indented) and
// root-level (full-width) files share markup. The only difference is
// the horizontal padding class, passed via `padClass`.
const FileRow = defineComponent({
  name: 'FileRow',
  props: {
    path: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    selected: { type: Boolean, default: false },
    deleteDisabled: { type: Boolean, default: false },
    padClass: { type: String, required: true },
    openFile: { type: Function, required: true },
    deleteFile: { type: Function, required: true },
  },
  setup(props) {
    return () =>
      h('div', {
        class: ['flex items-center group', props.selected ? 'bg-[var(--green)]/10' : ''],
      }, [
        h('button', {
          class: ['flex-1 text-left py-2 text-[13px] group-hover:bg-white/[0.02] transition-colors min-w-0', props.padClass],
          onClick: () => props.openFile(props.path),
        }, [
          h('div', { class: 'flex items-center gap-2' }, [
            h('span', { class: 'text-[13px] leading-none shrink-0' }, '📄'),
            h('span', { class: 'truncate font-medium' }, props.name),
          ]),
          h('div', { class: 't-mono text-[10px] mt-0.5 ml-[25px]' }, fmtSize(props.size)),
        ]),
        h('button', {
          class: [
            'shrink-0 flex items-center gap-1.5 mx-2 px-3 py-2 rounded-md border text-[12px] font-medium transition-all',
            props.deleteDisabled
              ? 'border-transparent text-[var(--text-mute)] opacity-35 cursor-not-allowed'
              : 'border-transparent text-[var(--text-mute)] hover:text-[var(--red)] hover:border-[rgba(224,85,85,0.35)] hover:bg-[rgba(224,85,85,0.1)]',
          ],
          disabled: props.deleteDisabled,
          onClick: () => { if (!props.deleteDisabled) props.deleteFile(props.path) },
          'aria-label': `Delete ${props.name}`,
          title: props.deleteDisabled ? "Can't delete config files while printing" : `Delete ${props.name}`,
        }, [
          h('svg', {
            class: 'w-4 h-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24', 'stroke-width': '1.75',
          }, [
            h('path', {
              'stroke-linecap': 'round', 'stroke-linejoin': 'round',
              d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
            }),
          ]),
          h('span', 'Delete'),
        ]),
      ])
  },
})

// Editing config and (more importantly) restarting Klipper mid-print is
// a great way to ruin a job. Block both buttons whenever a print is
// active (printing, preparing, or paused).
const jobActive = computed(() => printer.isPrinting || printer.isPaused)

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

const editorHost = ref<HTMLDivElement>()
let editorView: EditorView | null = null

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
function hideTip() { tip.visible = false }
const SAVE_TIP = "Can't save while printing"
const RESTART_TIP = "Can't restart while printing"
const showSaveTip = () => showTip(saveBtn.value, SAVE_TIP)
const showRestartTip = () => showTip(restartBtn.value, RESTART_TIP)

interface TreeEntry {
  name: string
  path: string
  size?: number
  isDir: boolean
  children?: TreeEntry[]
}

const tree = ref<TreeEntry[]>([])

function buildTree(rawFiles: Array<{ path: string; size: number; modified: number }>): TreeEntry[] {
  const root: TreeEntry[] = []
  for (const f of rawFiles) {
    const parts = f.path.split('/')
    let level = root
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1
      const name = parts[i]
      let existing = level.find(e => e.name === name && e.isDir === !isLast)
      if (!existing) {
        existing = {
          name,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          size: isLast ? f.size : undefined,
          children: isLast ? undefined : [],
        }
        level.push(existing)
        level.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
      if (!isLast && existing.children) level = existing.children
    }
  }
  return root
}

function toggle() {
  if (show.value) {
    show.value = false
    return
  }
  show.value = true
  view.value = 'list'
  loadFiles()
}

function close() {
  if (view.value === 'editor' && changed.value) {
    if (!confirm(UNSAVED_PROMPT)) return
  }
  show.value = false
}

async function loadFiles() {
  loading.value = true
  try {
    const raw = await getConfigFiles()
    tree.value = buildTree(raw)
    collapsed.value = new Set(tree.value.filter(e => e.isDir).map(e => e.path))
  } catch (e) {
    banner.show('Failed to load config files', errMsg(e))
  }
  loading.value = false
}

function createEditor(doc: string) {
  destroyEditor()
  if (!editorHost.value) return
  editorView = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        klipperConfig,
        syntaxHighlighting(HighlightStyle.define([
          { tag: tags.comment, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' },
          { tag: tags.keyword, color: 'var(--green)', fontWeight: '600' },
          { tag: tags.variableName, color: 'rgba(255,255,255,0.45)' },
          { tag: tags.number, color: 'var(--blue)' },
          { tag: tags.string, color: 'rgba(139,175,52,0.65)' },
          { tag: tags.typeName, color: 'var(--amber)' },
          { tag: tags.atom, color: '#c586c0' },
        ])),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changed.value = true
        }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'var(--bg-terminal)' },
          '.cm-scroller': { fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace', fontSize: '13px', lineHeight: '1.8' },
          '.cm-gutters': { backgroundColor: '#0c0d10', borderRight: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.2)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.02)' },
          '.cm-activeLine': { backgroundColor: 'rgba(139,175,52,0.04)' },
          '.cm-cursor': { borderLeftColor: 'var(--green)' },
          '.cm-selectionBackground': { backgroundColor: 'rgba(139,175,52,0.2) !important' },
          '.cm-matchingBracket': { backgroundColor: 'rgba(139,175,52,0.12)', outline: '1px solid rgba(139,175,52,0.3)' },
          '.cm-line': { padding: '0 4px' },
        }),
      ],
    }),
    parent: editorHost.value,
  })
}

function destroyEditor() {
  if (editorView) { editorView.destroy(); editorView = null }
}

async function openFile(p: string) {
  selected.value = p
  changed.value = false
  newFileName.value = ''
  view.value = 'editor'
}

function startNewFile() {
  selected.value = ''
  changed.value = false
  newFileName.value = ''
  view.value = 'editor'
}

// Create the editor when the view flips to 'editor'. Awaiting nextTick
// (and a frame, since <Transition> with mode="out-in" defers the new
// view) guarantees editorHost is mounted before we hand it to CodeMirror.
watch(view, async (v) => {
  if (v !== 'editor' || editorView) return
  await nextTick()
  await new Promise(requestAnimationFrame)
  if (!editorHost.value) return
  if (selected.value) {
    try {
      const text = await getConfigFile(selected.value)
      createEditor(text)
    } catch (e) {
      banner.show('Failed to read config', errMsg(e))
      view.value = 'list'
    }
  } else {
    createEditor('')
  }
})

// Back from the editor → list. Confirm if there are unsaved changes.
function cancel() {
  if (changed.value) {
    if (!confirm(UNSAVED_PROMPT)) return
  }
  destroyEditor()
  selected.value = ''
  changed.value = false
  newFileName.value = ''
  view.value = 'list'
}

async function save() {
  if (jobActive.value) return
  await saveFile()
}

async function saveAndRestart() {
  if (!selected.value || jobActive.value) return
  const ok = await saveFile()
  if (!ok) return
  // Klipper restart kicks the printer offline briefly. Warn the user,
  // then issue the restart. We close the editor regardless — the WS will
  // disconnect and reconnect once Klipper is back.
  banner.show('Restarting Klipper — printer will be briefly offline')
  try {
    await restartKlipper()
  } catch (e) {
    banner.show('File saved, but Klipper restart failed', errMsg(e))
  }
}

async function saveFile(): Promise<boolean> {
  const fp = selected.value || newFileName.value
  if (!fp || !changed.value) return false
  saving.value = true
  try {
    const doc = editorView?.state.doc.toString() || ''
    await saveConfigFile(fp, doc)
    toast.show(`Saved ${fp}`)
    destroyEditor()
    selected.value = ''
    changed.value = false
    newFileName.value = ''
    view.value = 'list'
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
  if (jobActive.value) return
  const filename = splitPath(p)
  const confirmation = window.prompt(
    `Permanently delete “${p}”?\n\nThis may break the printer configuration and cannot be undone. Type “${filename}” to confirm.`,
  )
  if (confirmation !== filename) return
  try {
    await deleteConfigFile(p)
    toast.show(`Deleted ${p}`)
    if (selected.value === p) {
      destroyEditor()
      selected.value = ''
      changed.value = false
      newFileName.value = ''
      view.value = 'list'
    }
    await loadFiles()
  } catch (e) {
    banner.show('Failed to delete config', errMsg(e))
  }
}

function toggleCollapse(p: string) {
  const s = collapsed.value
  if (s.has(p)) s.delete(p); else s.add(p)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && show.value) close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  destroyEditor()
})
</script>

<template>
  <button class="btn btn-ghost btn-sm" @click="toggle">Config</button>

  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-6 modal-container">
        <!-- Backdrop: only dismisses from the file list, never while editing -->
        <div v-if="view === 'list'" class="absolute inset-0 bg-black/70 backdrop-blur-sm modal-backdrop" @click="close"></div>
        <div v-else class="absolute inset-0 bg-black/70 modal-backdrop" aria-hidden="true"></div>

        <Transition name="view">
          <!-- ── List view ── -->
          <div v-if="view === 'list'" key="list" class="relative flex flex-col w-full max-w-3xl h-[90vh] rounded-2xl card shadow-2xl overflow-hidden">
            <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
              <div class="flex items-center gap-3">
                <div class="t-title">Config files</div>
                <span v-if="!loading && tree.length > 0" class="t-mute font-mono">{{ tree.length }} entries</span>
              </div>
              <div class="flex items-center gap-1">
                <button class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]" @click="loadFiles" :disabled="loading" aria-label="Reload" title="Reload">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]" @click="startNewFile" aria-label="New file" title="New file">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                </button>
                <button class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]" @click="close" aria-label="Close" title="Close">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto">
              <div v-if="loading" class="px-5 py-10 text-center">
                <span class="spinner spinner-sm"></span>
              </div>

              <template v-else>
                <template v-for="entry in tree" :key="entry.path">
                  <template v-if="entry.isDir">
                    <button class="w-full flex items-center gap-2 px-5 py-2 text-[13px] font-medium text-[var(--text-dim)] hover:bg-white/[0.02] transition-colors" @click="toggleCollapse(entry.path)">
                      <span class="text-[11px] w-4">{{ collapsed.has(entry.path) ? '▸' : '▾' }}</span>
                      <span class="text-[14px] leading-none">📂</span>
                      <span class="truncate">{{ entry.name }}</span>
                    </button>
                    <template v-if="!collapsed.has(entry.path)">
                      <FileRow
                        v-for="sub in entry.children"
                        :key="sub.path"
                        :path="sub.path"
                        :name="sub.name"
                        :size="sub.size"
                        :selected="selected === sub.path"
                        :delete-disabled="jobActive"
                        pad-class="pl-12 pr-3"
                        :open-file="openFile"
                        :delete-file="delFile"
                      />
                    </template>
                  </template>

                  <FileRow
                    v-else
                    :path="entry.path"
                    :name="entry.name"
                    :size="entry.size"
                    :selected="selected === entry.path"
                    :delete-disabled="jobActive"
                    pad-class="px-5"
                    :open-file="openFile"
                    :delete-file="delFile"
                  />
                </template>
              </template>
            </div>
          </div>

          <!-- ── Editor view ── -->
          <div v-else key="editor" class="relative flex flex-col w-full max-w-6xl h-[90vh] rounded-2xl card shadow-2xl overflow-hidden">
            <div class="flex items-center justify-between shrink-0 px-4 py-3 border-b border-[var(--border)] gap-4">
              <div class="flex items-center gap-3 min-w-0">
                <button class="btn btn-ghost btn-sm !h-7 !px-2 text-[12px]" @click="cancel" aria-label="Back to files" title="Back">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div v-if="selected" class="text-[14px] font-medium truncate">{{ selected }}</div>
                <div v-else class="flex items-center gap-2 min-w-0">
                  <span class="text-[14px] text-[var(--text-mute)] shrink-0">New file</span>
                  <input
                    v-model="newFileName"
                    class="input !h-7 text-[12px] w-40"
                    placeholder="filename.cfg"
                  />
                </div>
                <span v-if="changed" class="text-[11px] text-[var(--amber)] uppercase tracking-wider shrink-0">Unsaved</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="btn btn-sm" @click="cancel">Cancel</button>
                <button
                  v-if="selected"
                  ref="restartBtn"
                  class="btn btn-sm"
                  :disabled="!changed || saving || jobActive"
                  @mouseenter="showRestartTip"
                  @mouseleave="hideTip"
                  @click="saveAndRestart"
                >Save + Restart</button>
                <button
                  ref="saveBtn"
                  class="btn btn-primary btn-sm"
                  :disabled="!changed || saving || (!selected && !newFileName) || jobActive"
                  @mouseenter="showSaveTip"
                  @mouseleave="hideTip"
                  @click="save"
                >{{ saving ? 'Saving…' : 'Save' }}</button>
              </div>
            </div>

            <div ref="editorHost" class="flex-1 overflow-hidden term-panel"></div>
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
        :style="{ top: `${tip.y}px`, left: `${tip.x}px`, transform: 'translateX(-50%)' }"
        role="tooltip"
      >{{ tip.text }}</div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal: fade the whole overlay in/out. */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from, .modal-leave-to {
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
.view-enter-active, .view-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.view-leave-active {
  /* Outgoing view is absolute-positioned during its leave so the incoming
     view can sit on top of the same slot. */
  position: absolute; inset: 0;
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
.tip-enter-active, .tip-leave-active {
  transition: opacity 0.12s ease;
}
.tip-enter-from, .tip-leave-to {
  opacity: 0;
}
</style>
