<template>
    <div class="aif" role="group" :aria-label="$t('AiFeedback.label')">
        <div class="aif__thumbs">
            <button
                ref="upButton"
                type="button"
                class="aif__thumb"
                :class="{ 'is-on': rating === 'up' }"
                data-test="feedback-up"
                :aria-pressed="String(rating === 'up')"
                :aria-label="$t('AiFeedback.up')"
                :title="$t('AiFeedback.up')"
                :disabled="busy"
                @click="rate('up')"
            ><span aria-hidden="true">👍</span></button>
            <button
                ref="downButton"
                type="button"
                class="aif__thumb"
                :class="{ 'is-on': rating === 'down' }"
                data-test="feedback-down"
                :aria-pressed="String(rating === 'down')"
                :aria-label="$t('AiFeedback.down')"
                :title="$t('AiFeedback.down')"
                :disabled="busy"
                @click="rate('down')"
            ><span aria-hidden="true">👎</span></button>
            <span v-if="thanks" class="aif__status" data-test="feedback-thanks" role="status">{{ $t('AiFeedback.thanks') }}</span>
            <span v-else-if="error" class="aif__status aif__status--error" role="alert">{{ error }}</span>
        </div>

        <div v-if="asking" class="aif__reasons" data-test="feedback-reasons" @keydown.esc.stop.prevent="closeReasons">
            <div :id="`${uid}-title`" class="aif__title">{{ $t('AiFeedback.reasons_title') }}</div>
            <div class="aif__chips" role="group" :aria-labelledby="`${uid}-title`">
                <button
                    v-for="(key, i) in FEEDBACK_REASONS"
                    :key="key"
                    :ref="(el) => { if (i === 0) firstChip = el; }"
                    type="button"
                    class="aif__chip"
                    :class="{ 'is-on': picked.includes(key) }"
                    :aria-pressed="String(picked.includes(key))"
                    :data-reason="key"
                    @click="toggle(key)"
                >{{ $t(`AiFeedback.reason_${key}`) }}</button>
            </div>
            <input
                v-model.trim="note"
                type="text"
                class="ah-input aif__note"
                maxlength="300"
                data-test="feedback-note"
                :placeholder="$t('AiFeedback.note_placeholder')"
                :aria-label="$t('AiFeedback.note_label')"
            />
            <label v-if="answer" class="aif__share">
                <input v-model="share" type="checkbox" data-test="feedback-share" />
                <span>{{ $t('AiFeedback.share') }}</span>
            </label>
            <div class="aif__actions">
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="feedback-send" :disabled="busy" @click="send">{{ $t('AiFeedback.send') }}</button>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="feedback-skip" :disabled="busy" @click="closeReasons">{{ $t('AiFeedback.skip') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { FEEDBACK_REASONS, loadMine, newItemId, removeFeedback, saveFeedback } from "./aiFeedback";

defineOptions({ name: "AiFeedback" });

const props = defineProps({
    feature: { type: String, required: true },
    kind: { type: String, required: true },
    itemId: { type: String, default: "" },
    model: { type: String, default: "" },
    answer: { type: String, default: "" },
    sources: { type: Array, default: () => [] }
});

const { t } = useI18n();
const uid = `aif-${Math.random().toString(36).slice(2, 9)}`;
const item = props.itemId || newItemId();

const rating = ref(null);
const savedId = ref("");
const asking = ref(false);
const picked = ref([]);
const note = ref("");
const share = ref(false);
const busy = ref(false);
const thanks = ref(false);
const error = ref("");
const upButton = ref(null);
const downButton = ref(null);
let firstChip = null;

const base = () => ({ feature: props.feature, kind: props.kind, itemId: item, ...(props.model ? { model: props.model } : {}) });

const apply = (saved) => {
    savedId.value = saved?.id || "";
    rating.value = saved?.rating || null;
};

const attempt = async (work) => {
    busy.value = true;
    error.value = "";
    try {
        return await work();
    } catch (e) {
        error.value = e?.response?.data?.statusText || e?.message || t("AiFeedback.failed");
        return null;
    } finally {
        busy.value = false;
    }
};

const closeReasons = async () => {
    asking.value = false;
    await nextTick();
    downButton.value?.focus();
};

const rate = async (value) => {
    thanks.value = false;
    if (rating.value === value && savedId.value) {
        const removed = await attempt(() => removeFeedback(savedId.value));
        if (removed) {
            apply(null);
            asking.value = false;
        }
        return;
    }
    const saved = await attempt(() => saveFeedback({ ...base(), rating: value }));
    if (!saved) return;
    apply(saved);
    if (value === "up") {
        asking.value = false;
        thanks.value = true;
        return;
    }
    picked.value = [];
    note.value = "";
    share.value = false;
    asking.value = true;
    await nextTick();
    firstChip?.focus();
};

const toggle = (key) => {
    picked.value = picked.value.includes(key) ? picked.value.filter((k) => k !== key) : [...picked.value, key];
};

const send = async () => {
    const body = { ...base(), rating: "down", reasons: [...picked.value], note: note.value, includeAnswer: share.value };
    if (share.value) Object.assign(body, { answer: props.answer, sources: props.sources });
    const saved = await attempt(() => saveFeedback(body));
    if (!saved) return;
    apply(saved);
    thanks.value = true;
    await closeReasons();
};

onMounted(async () => {
    if (!props.itemId) return;
    try {
        const saved = await loadMine(props.itemId);
        if (saved && !rating.value) apply(saved);
    } catch {
        /* a rating that cannot be read back still lets the person rate again */
    }
});
</script>

<style scoped>
.aif { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.aif__thumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.aif__thumb {
    min-width: 32px; min-height: 32px; padding: 0 6px;
    display: inline-grid; place-items: center;
    border: 1px solid var(--hairline); border-radius: 7px;
    background: var(--surface); color: var(--ink); cursor: pointer;
    font-size: 14px; line-height: 1;
}
.aif__thumb:hover:not(:disabled) { background: var(--fill); }
.aif__thumb.is-on { border-color: var(--brand); background: var(--brand-tint); }
.aif__thumb:disabled { opacity: .6; cursor: default; }
.aif__thumb:focus-visible, .aif__chip:focus-visible { outline: none; box-shadow: var(--focus, 0 0 0 3px var(--brand-ring)); }
.aif__status { margin-left: 6px; font: var(--text-small); color: var(--ink-2); }
.aif__status--error { color: var(--danger, var(--ink)); }
.aif__reasons {
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 9px; background: var(--surface);
}
.aif__title { font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.aif__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.aif__chip {
    min-height: 28px; padding: 2px 10px; border-radius: 999px;
    border: 1px solid var(--hairline); background: var(--fill); color: var(--ink);
    font: var(--text-small); cursor: pointer;
}
.aif__chip.is-on { background: var(--brand-tint); color: var(--brand); border-color: var(--brand); }
.ah-input.aif__note { width: 100%; max-width: 420px; height: 32px; box-sizing: border-box; }
.aif__share { display: flex; align-items: flex-start; gap: 6px; font: var(--text-small); color: var(--ink); cursor: pointer; }
.aif__share input { margin-top: 2px; }
.aif__actions { display: flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 480px) {
    .aif__actions .ah-btn { flex: 1 1 auto; }
}
</style>
