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
            :aria-expanded="Boolean(mention)"
            :aria-controls="listId"
            :aria-activedescendant="mention && matches.length ? `${listId}-${active}` : undefined"
            @input="onInput"
            @keydown="onKeydown"
            @click="syncMention"
            @blur="onBlur"
        ></textarea>
        <ul v-if="mention" :id="listId" class="pci__list" role="listbox" :aria-label="$t('Docs.comment_mention_list')">
            <li
                v-for="(person, index) in matches"
                :id="`${listId}-${index}`"
                :key="person.id"
                class="pci__option"
                :class="{ 'is-active': index === active }"
                role="option"
                :aria-selected="index === active"
                @mousedown.prevent="pick(person)"
                @mouseenter="active = index"
            >
                <span class="ah-avatar ah-avatar--sm" aria-hidden="true">{{ initials(person.name) }}</span>
                <span class="pci__name">{{ person.name }}</span>
            </li>
            <li v-if="!matches.length" class="pci__option pci__option--none" role="option" aria-disabled="true">{{ $t('Docs.comment_mention_none') }}</li>
        </ul>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, useId } from 'vue';
import { initials } from './docsFormat';
import { insertMention, mentionQueryAt } from './pageComments';

defineOptions({ name: 'PageCommentInput' });

const props = defineProps({
    modelValue: { type: String, default: '' },
    people: { type: Array, default: () => [] },
    placeholder: { type: String, default: '' },
    label: { type: String, default: '' },
    autofocus: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'submit', 'cancel']);

const MAX_MATCHES = 6;
const field = ref(null);
const mention = ref(null);
const active = ref(0);
const listId = `pci-${useId()}`;

const matches = computed(() => {
    if (!mention.value) return [];
    const query = mention.value.query.toLowerCase();
    return props.people.filter((person) => person.name.toLowerCase().replace(/\s+/g, '').includes(query)).slice(0, MAX_MATCHES);
});

function syncMention() {
    const el = field.value;
    mention.value = el ? mentionQueryAt(el.value, el.selectionStart) : null;
    active.value = 0;
}

function onInput(event) {
    emit('update:modelValue', event.target.value);
    syncMention();
}

function pick(person) {
    const el = field.value;
    if (!el || !mention.value) return;
    const next = insertMention(el.value, mention.value.start, el.selectionStart, person);
    emit('update:modelValue', next.text);
    mention.value = null;
    nextTick(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
    });
}

function onKeydown(event) {
    if (mention.value) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            active.value = Math.min(Math.max(active.value + step, 0), Math.max(matches.value.length - 1, 0));
            return;
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && matches.value.length) {
            event.preventDefault();
            pick(matches.value[active.value]);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            mention.value = null;
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

function onBlur() {
    mention.value = null;
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
.pci__list {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 5;
    margin: 0; padding: 4px; list-style: none;
    background: var(--surface); border: 1px solid var(--border); border-radius: 9px;
    box-shadow: var(--shadow-card);
}
.pci__option {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: 6px; cursor: pointer;
    font-size: 13px; color: var(--ink);
}
.pci__option.is-active { background: var(--brand-tint); }
.pci__option--none { cursor: default; color: var(--ink-2); }
.pci__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
