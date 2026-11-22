<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { getConfigFile } from '@/api/moonraker'

const props = defineProps<{ path: string }>()
const emit = defineEmits<{ change: []; error: [error: unknown] }>()
const host = ref<HTMLDivElement>()
const loading = ref(true)
let editor: EditorView | undefined
let disposed = false

const klipperConfig = StreamLanguage.define({
  token(stream) {
    if (stream.sol() && stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }

    if (stream.match('{%')) {
      stream.eatWhile((c) => c !== '%')
      if (!stream.match('%}')) stream.skipToEnd()
      return 'typeName'
    }

    if (stream.match('{{')) {
      stream.eatWhile((c) => c !== '}')
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

function createEditor(doc: string) {
  if (!host.value) return
  editor = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        klipperConfig,
        syntaxHighlighting(
          HighlightStyle.define([
            {
              tag: tags.comment,
              color: 'rgba(255,255,255,0.25)',
              fontStyle: 'italic',
            },
            { tag: tags.keyword, color: 'var(--green)', fontWeight: '600' },
            { tag: tags.variableName, color: 'rgba(255,255,255,0.45)' },
            { tag: tags.number, color: 'var(--blue)' },
            { tag: tags.string, color: 'rgba(139,175,52,0.65)' },
            { tag: tags.typeName, color: 'var(--amber)' },
            { tag: tags.atom, color: '#c586c0' },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('change')
        }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'var(--bg-terminal)' },
          '.cm-scroller': {
            fontFamily:
              '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
            fontSize: '13px',
            lineHeight: '1.8',
          },
          '.cm-gutters': {
            backgroundColor: '#0c0d10',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.2)',
          },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.02)' },
          '.cm-activeLine': { backgroundColor: 'rgba(139,175,52,0.04)' },
          '.cm-cursor': { borderLeftColor: 'var(--green)' },
          '.cm-selectionBackground': {
            backgroundColor: 'rgba(139,175,52,0.2) !important',
          },
          '.cm-matchingBracket': {
            backgroundColor: 'rgba(139,175,52,0.12)',
            outline: '1px solid rgba(139,175,52,0.3)',
          },
          '.cm-line': { padding: '0 4px' },
        }),
      ],
    }),
    parent: host.value,
  })
}

onMounted(async () => {
  try {
    const text = props.path ? await getConfigFile(props.path) : ''
    if (!disposed) createEditor(text)
  } catch (error) {
    if (!disposed) emit('error', error)
  } finally {
    if (!disposed) loading.value = false
  }
})

onBeforeUnmount(() => {
  disposed = true
  editor?.destroy()
  editor = undefined
})

defineExpose({ read: () => editor?.state.doc.toString() })
</script>

<template>
  <div class="flex-1 overflow-hidden term-panel">
    <p v-if="loading" class="px-5 py-4 t-mute" role="status">Loading config…</p>
    <div ref="host" class="h-full"></div>
  </div>
</template>
