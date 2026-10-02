<template>
  <div
    class="wb-note"
    :class="[`is-${note.type}`, note.type === 'note' ? `tone-${note.tone}` : '', { 'is-selected': selected, 'is-dragging': dragging, 'is-fixed': !canEdit }]"
    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, zIndex: dragging ? 1000 : selected ? 999 : Math.min(900, 10 + (note.z || 0)) }"
    :data-wb-note="note.id"
    :tabindex="0"
    role="group"
    :aria-label="$t(note.type === 'note' ? 'Views.whiteboard_note' : 'Views.whiteboard_text')"
    @pointerdown="$emit('press', $event)"
    @dblclick="$emit('edit')"
    @keydown="onKey"
  >
    <textarea
      v-if="editing"
      ref="input"
      class="wb-note__input"
      :value="note.text"
      :maxlength="textLimit"
      :aria-label="$t(note.type === 'note' ? 'Views.whiteboard_note_input' : 'Views.whiteboard_text_input')"
      :placeholder="placeholder"
      @input="$emit('retype', $event.target.value)"
      @blur="$emit('done')"
      @keydown.stop="onInputKey"
      @pointerdown.stop
    ></textarea>
    <div v-else class="wb-note__text" :class="{ 'is-empty': !note.text }">{{ note.text || placeholder }}</div>

    <div v-if="selected && canEdit" class="wb-note__tools" data-wb-note-tools @pointerdown.stop @dblclick.stop>
      <template v-if="note.type === 'note'">
        <button
          v-for="tone in tones"
          :key="tone"
          type="button"
          class="wb-note__tone"
          :class="[`tone-${tone}`, { 'is-current': tone === note.tone }]"
          :data-wb-tone="tone"
          :aria-label="$t(`Views.whiteboard_tone_${tone}`)"
          :aria-pressed="tone === note.tone"
          :title="$t(`Views.whiteboard_tone_${tone}`)"
          @click="$emit('tone', tone)"
        ></button>
      </template>
      <button type="button" class="wb-note__tool" data-wb-note-edit @click="$emit('edit')">{{ $t('Views.whiteboard_note_edit') }}</button>
      <button type="button" class="wb-note__tool" data-wb-note-delete @click="$emit('remove')">{{ $t('Views.whiteboard_note_delete') }}</button>
    </div>
    <span
      v-if="selected && canEdit"
      class="wb-note__resize"
      data-wb-note-resize
      role="presentation"
      :title="$t('Views.whiteboard_note_resize')"
      @pointerdown.stop="$emit('resize', $event)"
    ></span>
  </div>
</template>

<script>
export default { name: 'WhiteboardNote' };
</script>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { NOTE_TONES } from './useWhiteboardBoard';

const props = defineProps({
    note: { type: Object, required: true },
    box: { type: Object, required: true },
    selected: { type: Boolean, default: false },
    editing: { type: Boolean, default: false },
    dragging: { type: Boolean, default: false },
    canEdit: { type: Boolean, default: false },
    textLimit: { type: Number, default: 2000 },
});
const emit = defineEmits(['press', 'edit', 'done', 'retype', 'tone', 'remove', 'resize']);

const { t } = useI18n();
const tones = NOTE_TONES;
const input = ref(null);
const placeholder = computed(() => t(props.note.type === 'note' ? 'Views.whiteboard_note_placeholder' : 'Views.whiteboard_text_placeholder'));

watch(() => props.editing, (editing) => { if (editing) nextTick(() => input.value?.focus()); }, { immediate: true });

function onKey(event) {
    if (!props.canEdit || props.editing) return;
    if (event.key === 'Enter') { event.preventDefault(); emit('edit'); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); emit('remove'); }
}
function onInputKey(event) {
    if (event.key === 'Escape') emit('done');
}
</script>

<style scoped>
.wb-note { position: absolute; box-sizing: border-box; display: flex; padding: 8px 10px; border: 1px solid transparent; border-radius: var(--r-input); color: var(--ink); cursor: grab; user-select: none; touch-action: none; }
.wb-note:focus-visible { outline: none; box-shadow: var(--focus); }
.wb-note.is-fixed { cursor: default; touch-action: pan-x pan-y; }
.wb-note.is-dragging { cursor: grabbing; box-shadow: var(--shadow-pop); }
.wb-note.is-note { background: linear-gradient(var(--tone), var(--tone)), var(--surface); border-color: var(--hairline); box-shadow: var(--shadow-card); }
.wb-note.is-text.is-selected, .wb-note.is-text:hover { border-color: var(--border); border-style: dashed; }
.wb-note.is-note.is-selected { border-color: var(--brand); }
.tone-amber { --tone: var(--warn-bg); }
.tone-green { --tone: var(--ok-bg); }
.tone-red { --tone: var(--danger-bg); }
.tone-violet { --tone: var(--agent-bg); }
.tone-brand { --tone: var(--brand-tint); }
.tone-grey { --tone: var(--fill); }
.wb-note__text, .wb-note__input { flex: 1 1 auto; min-width: 0; width: 100%; margin: 0; padding: 0; font: inherit; font-size: 13px; line-height: 1.4; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; overflow: hidden; }
.wb-note.is-text .wb-note__text, .wb-note.is-text .wb-note__input { font-size: 15px; font-weight: 600; }
.wb-note__text.is-empty { color: var(--ink-2); }
.wb-note__input { border: 0; outline: none; background: transparent; resize: none; overflow: auto; cursor: text; user-select: text; touch-action: auto; }
.wb-note__tools { position: absolute; top: 100%; left: 0; margin-top: 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 6px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-input); box-shadow: var(--shadow-pop); cursor: default; white-space: nowrap; }
.wb-note__tone { width: 20px; height: 20px; padding: 0; border: 1px solid var(--border); border-radius: 50%; background: linear-gradient(var(--tone), var(--tone)), var(--surface); cursor: pointer; }
.wb-note__tone.is-current { border-color: var(--brand); box-shadow: var(--focus); }
.wb-note__tone:focus-visible, .wb-note__tool:focus-visible { outline: none; box-shadow: var(--focus); }
.wb-note__tool { border: 0; background: transparent; color: var(--ink); font-size: 12px; padding: 3px 6px; border-radius: var(--r-chip); cursor: pointer; }
.wb-note__tool:hover { background: var(--surface-hover); }
.wb-note__resize { position: absolute; right: -6px; bottom: -6px; width: 16px; height: 16px; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); cursor: nwse-resize; touch-action: none; }
</style>
