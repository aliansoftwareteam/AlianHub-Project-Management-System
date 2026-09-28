<template>
    <section
        ref="root"
        class="aip"
        role="region"
        tabindex="-1"
        :aria-label="heading"
        :aria-busy="busy ? 'true' : 'false'"
        @keydown.esc.stop.prevent="$emit('cancel')"
    >
        <header class="aip__head">
            <span class="aip__mark" aria-hidden="true">✦</span>
            <span class="aip__title">{{ heading }}</span>
            <span v-if="busy" class="aip__busy">{{ $t('AiPreview.working') }}</span>
        </header>
        <div class="aip__body ah-scroll" aria-live="polite">
            <slot>
                <p class="aip__text">{{ text }}</p>
            </slot>
        </div>
        <div class="aip__actions">
            <button v-if="showReplace" type="button" class="ah-btn ah-btn--primary ah-btn--sm aip__replace" :disabled="busy" @click="$emit('replace')">{{ replaceLabel || $t('AiPreview.replace') }}</button>
            <button v-if="showInsert" type="button" class="ah-btn ah-btn--secondary ah-btn--sm aip__insert" :disabled="busy" @click="$emit('insert')">{{ insertLabel || $t('AiPreview.insert') }}</button>
            <button v-if="showCopy" type="button" class="ah-btn ah-btn--secondary ah-btn--sm aip__copy" :disabled="busy" @click="copy">{{ copied ? $t('AiPreview.copied') : $t('AiPreview.copy') }}</button>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm aip__retry" :disabled="busy" @click="$emit('retry')">{{ $t('AiPreview.retry') }}</button>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm aip__cancel" @click="$emit('cancel')">{{ $t('AiPreview.cancel') }}</button>
        </div>
    </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'AiResultPreview' });

const props = defineProps({
    text: { type: String, default: '' },
    title: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    showReplace: { type: Boolean, default: true },
    showInsert: { type: Boolean, default: false },
    showCopy: { type: Boolean, default: false },
    replaceLabel: { type: String, default: '' },
    insertLabel: { type: String, default: '' },
    returnFocus: { type: [Object, Function], default: null },
});

const emit = defineEmits(['replace', 'insert', 'retry', 'cancel', 'copy']);

const { t } = useI18n();
const root = ref(null);
const copied = ref(false);
const heading = computed(() => props.title || t('AiPreview.title'));
let opener = null;

function focusTarget() {
    const target = typeof props.returnFocus === 'function' ? props.returnFocus() : props.returnFocus;
    return target || opener;
}

async function copy() {
    try {
        await navigator.clipboard.writeText(props.text);
        copied.value = true;
        emit('copy');
    } catch (error) {
        console.error('ERROR in copying the AI result: ', error);
    }
}

// The action a person pressed is disabled while the next result loads, which drops focus to the page.
watch(() => props.busy, (busy) => {
    const active = document.activeElement;
    if (!busy && root.value && (!active || active === document.body)) root.value.focus();
}, { flush: 'post' });

onMounted(() => {
    opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    nextTick(() => root.value && root.value.focus({ preventScroll: false }));
});

/* Focus goes back to whatever opened the preview, but only when it would otherwise be lost with the
 * preview; a person who has already moved on keeps their place. */
onBeforeUnmount(() => {
    const active = document.activeElement;
    const lost = !active || active === document.body || (root.value && root.value.contains(active));
    const target = focusTarget();
    if (lost && target && target.isConnected && typeof target.focus === 'function') target.focus();
});
</script>

<style scoped>
.aip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--brand-border);
    border-radius: 9px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 0 0 3px var(--brand-ring);
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
}
.aip:focus { outline: none; }
.aip:focus-visible { box-shadow: var(--focus, 0 0 0 3px var(--brand-ring)); }
.aip__head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.aip__mark {
    width: 20px; height: 20px; border-radius: 6px; flex: none;
    display: inline-grid; place-items: center;
    background: var(--brand-tint); color: var(--brand); font-size: 11px;
}
.aip__title { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.aip__busy { margin-left: auto; font: 500 12px/1.3 var(--font-ui); color: var(--ink-2); }
.aip__body { max-height: 240px; overflow: auto; overflow-wrap: anywhere; }
.aip__text { margin: 0; font: 400 13px/1.55 var(--font-ui); white-space: pre-wrap; color: var(--ink); }
.aip__actions { display: flex; flex-wrap: wrap; gap: 6px; }
.aip__actions .ah-btn { min-height: 32px; }
@media (max-width: 480px) {
    .aip__actions .ah-btn { flex: 1 1 auto; }
}
</style>
