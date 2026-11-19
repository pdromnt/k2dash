<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { beltCalibrationGuide, beltPreviewSteps } from '@/printer/beltCalibrationPreview'

// This surface deliberately has no printer store, transport, or command executor.
const stepIndex = ref<number | null>(null)
const checked = ref(false)
const heading = ref<HTMLElement>()
const openButton = ref<HTMLButtonElement>()
const step = computed(() => stepIndex.value === null ? undefined : beltPreviewSteps[stepIndex.value])
const current = computed(() => (stepIndex.value ?? 0) + 1)

function showAt(index: number) {
  checked.value = false
  stepIndex.value = index
  void nextTick(() => heading.value?.focus())
}

function close() {
  checked.value = false
  stepIndex.value = null
  void nextTick(() => openButton.value?.focus())
}

function advance() {
  if (checked.value && stepIndex.value !== null && step.value) showAt(stepIndex.value + 1)
}
</script>

<template>
  <div class="belt-module-preview">
    <div v-if="stepIndex === null" class="intro">
      <div class="intro-text">
        <h3>Belt module strain-gauge calibration</h3>
        <p>Rehearse the jig-based service procedure. Routine Belt calibration above still operates the printer.</p>
      </div>
      <button ref="openButton" class="btn" type="button" @click="showAt(0)">
        Open wizard preview
      </button>
    </div>
    <div v-else>
      <div class="preview-notice">
        <span>Simulation only</span>
        <p>No commands are sent. Don’t move the printer or fit the jig for this preview.</p>
      </div>

      <p v-if="step" class="progress-label">Step {{ current }} of {{ beltPreviewSteps.length }} · {{ step.group }}</p>
      <h3 ref="heading" tabindex="-1">{{ step?.title ?? 'Simulation complete' }}</h3>
      <template v-if="step">
        <p class="body-copy">{{ step.instruction }}</p>
        <a v-if="step.group === 'Setup' || step.title.startsWith('Fit')" :href="beltCalibrationGuide" class="guide-link" target="_blank" rel="noopener noreferrer">Creality’s jig and calibration guide (opens in a new tab)</a>
        <details v-if="step.trace.length" :key="stepIndex" class="fixture-trace">
          <summary>Inspect sample command excerpts</summary>
          <pre>{{ step.trace.join('\n') }}</pre>
        </details>
        <label class="sim-check">
          <input v-model="checked" type="checkbox">
          {{ step.acknowledge }}
        </label>
        <div class="wizard-actions">
          <button class="btn" type="button" @click="close">Close preview</button>
          <button v-if="current > 1" class="btn" type="button" @click="showAt(current - 2)">Back</button>
          <button class="btn btn-primary" type="button" :disabled="!checked" @click="advance">
            {{ current === beltPreviewSteps.length ? 'Finish simulation' : 'Next step' }}
          </button>
        </div>
      </template>
      <template v-else>
        <p class="body-copy">No calibration ran and no printer settings changed.</p>
        <div class="wizard-actions">
          <button class="btn" type="button" @click="showAt(0)">Restart simulation</button>
          <button class="btn btn-primary" type="button" @click="close">Close preview</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.belt-module-preview {
  border-top: 1px solid var(--border);
  padding: 16px 18px;
}
.intro {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.intro-text { flex: 1 1 280px; }
h3 { margin: 0; font-size: .96rem; font-weight: 650; }
.intro p, .body-copy, .preview-notice p {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: .875rem;
  line-height: 1.55;
  max-width: 68ch;
}
.preview-notice {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 17px;
}
.preview-notice span { color: var(--amber); font-size: .875rem; font-weight: 650; }
.progress-label {
  font-size: .8rem;
  color: var(--text-mute);
  margin: 0 0 4px;
  font-variant-numeric: tabular-nums;
}
.guide-link {
  display: inline-block;
  color: var(--blue);
  font-size: .85rem;
  margin-top: 8px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.fixture-trace { margin-top: 12px; color: var(--text-dim); font-size: .82rem; }
.fixture-trace summary { cursor: pointer; padding-block: 5px; }
.fixture-trace pre {
  max-width: 68ch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-radius: 8px;
  background: var(--bg-terminal);
  border: 1px solid var(--border);
  padding: 10px 12px;
  margin: 4px 0 0;
}
.sim-check {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin-top: 10px;
  font-size: .875rem;
  color: var(--text);
  cursor: pointer;
}
.sim-check input { accent-color: var(--accent); width: 18px; height: 18px; flex: none; }
.wizard-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
@media (max-width: 520px) {
  .belt-module-preview { padding: 14px 12px; }
  .intro > .btn { width: 100%; }
  .wizard-actions > .btn-primary { flex-basis: 100%; }
}
</style>
