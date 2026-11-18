<template>
    <div class="pci">
        <textarea
            ref="field"
            class="ah-input pci__field"
            rows="2"
            :value="modelValue"
            :placeholder="placeholder"
            :aria-label="label || placeholder"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            :aria-expanded="Boolean(mention)"
            @input="onInput"
            @keydown="onKeydown"
            @click="syncMention"
            @blur="closeMention"
        ></textarea>
        <Teleport to="body">
            <DocMentionPicker
                v-if="mention"
                :query="mention.query"
                :position="position"
                :sources="sources"
                @ready="picker = $event"
                @pick="pick"
                @close="closeMention"
            />
        </Teleport>
    </div>
</template>

<script setup>
import { nextTick, onMounted, ref, shallowRef } from 'vue';
import DocMentionPicker from './DocMentionPicker.vue';
import { insertMention, mentionQueryAt } from './pageComments';

defineOptions({ name: 'PageCommentInput' });

const props = defineProps({
    modelValue: { type: String, default: '' },
    sources: { type: Object, required: true },
    placeholder: { type: String, default: '' },
    label: { type: String, default: '' },
    autofocus: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'submit', 'cancel']);

const PICKER_WIDTH = 320;
const ROOM_BELOW = 220;
const GAP = 6;
const EDGE = 8;

const field = ref(null);
const mention = ref(null);
const position = ref({ top: 0, left: 0 });
const picker = shallowRef(null);

/* The composer sits at the foot of the panel, so the list usually opens upwards, anchored to the field's top edge. */
function place(el) {
    const rect = el.getBoundingClientRect();
    const width = Math.min(PICKER_WIDTH, window.innerWidth - EDGE * 2);
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
    position.value = window.innerHeight - rect.bottom >= ROOM_BELOW
        ? { top: rect.bottom + GAP, left }
        : { bottom: window.innerHeight - rect.top + GAP, left };
}

function closeMention() {
    mention.value = null;
    picker.value = null;
}

function syncMention() {
    const el = field.value;
    const found = el ? mentionQueryAt(el.value, el.selectionStart) : null;
    if (!found) {
        closeMention();
        return;
    }
    place(el);
    mention.value = found;
}

function onInput(event) {
    emit('update:modelValue', event.target.value);
    syncMention();
}

function pick(item) {
    const el = field.value;
    if (!el || !mention.value) return;
    const next = insertMention(el.value, mention.value.start, el.selectionStart, item);
    emit('update:modelValue', next.text);
    closeMention();
    nextTick(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
    });
}

function onKeydown(event) {
    if (mention.value) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (picker.value) picker.value.move(event.key === 'ArrowDown' ? 1 : -1);
            return;
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
            if (picker.value && picker.value.choose()) {
                event.preventDefault();
                return;
            }
            closeMention();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeMention();
            return;
        }
    }
    if (event.key === 'Escape') {
        event.stopPropagation();
        emit('cancel');
    } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        emit('submit');
    }
}

function focus() {
    if (field.value) field.value.focus();
}

defineExpose({ focus });

onMounted(() => { if (props.autofocus) focus(); });
</script>

<style scoped>
.pci { position: relative; }
.pci__field {
    height: auto; min-height: 38px; max-height: 160px;
    padding: 8px 10px; resize: vertical;
    font: 400 13px/1.45 var(--font-ui);
}
</style>
