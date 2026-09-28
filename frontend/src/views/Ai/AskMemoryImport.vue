<template>
    <section class="ami" :aria-labelledby="headingId">
        <h3 :id="headingId" class="ami__title">{{ $t('AskMemory.import_title') }}</h3>
        <p class="ah-small ami__text">{{ $t('AskMemory.import_lead') }}</p>
        <div class="ami__copy">
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="memory-copy-prompt" @click="copyPrompt">
                <ShellIcon :name="copied ? 'check' : 'copy'" :size="13" />{{ copied ? $t('AskMemory.prompt_copied') : $t('AskMemory.copy_prompt') }}
            </button>
            <details class="ami__prompt">
                <summary class="ah-small">{{ $t('AskMemory.show_prompt') }}</summary>
                <p class="ah-small ami__prompt-text">{{ $t('AskMemory.import_prompt') }}</p>
            </details>
        </div>

        <p v-if="!aiUsable" class="ah-small ami__off" data-test="memory-import-off">{{ $t('AskMemory.import_off') }}</p>
        <div class="ah-field">
            <label class="ah-field__label" :for="pasteId">{{ $t('AskMemory.paste_label') }}</label>
            <textarea :id="pasteId" v-model="pasted" class="ah-input ah-textarea" :maxlength="limit" :placeholder="$t('AskMemory.paste_hint')" data-test="memory-paste"></textarea>
        </div>
        <div class="ami__actions">
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!aiUsable || !pasted.trim() || reading" data-test="memory-read-paste" @click="read">
                {{ reading ? $t('AskMemory.reading') : $t('AskMemory.read_paste') }}
            </button>
            <span class="ah-small">{{ $t('AskMemory.read_note') }}</span>
        </div>
        <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>

        <div v-if="preview" class="ami__preview" data-test="memory-preview">
            <p class="ah-small ami__text">{{ preview.items.length ? $t('AskMemory.preview_lead') : $t('AskMemory.preview_empty') }}</p>
            <p v-if="preview.stripped" class="ah-small ami__stripped" data-test="memory-preview-stripped">{{ $t('AskMemory.preview_stripped', { n: preview.stripped }) }}</p>
            <ul v-if="preview.items.length" class="ami__list">
                <li v-for="item in preview.items" :key="item.id" data-test="memory-preview-item">
                    <label class="ami__item">
                        <input v-model="chosen" type="checkbox" class="ah-check" :value="item.id" />
                        <span class="ah-chip">{{ $t(`AskMemory.kind_${item.kind}`) }}</span>
                        <span class="ami__item-text">{{ item.text }}</span>
                    </label>
                </li>
            </ul>
            <div class="ami__actions">
                <button v-if="preview.items.length" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!chosen.length || saving" data-test="memory-preview-confirm" @click="confirm">
                    {{ saving ? $t('AskMemory.saving') : $t('AskMemory.preview_confirm', { n: chosen.length }) }}
                </button>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="memory-preview-discard" @click="discard">{{ $t('AskMemory.preview_discard') }}</button>
            </div>
        </div>
    </section>
</template>

<script setup>
import { ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { aiUsable } from "@/composable/aiAvailability";
import { memoryErrorKey } from "./askMemory";

defineOptions({ name: "AskMemoryImport" });
defineProps({ limit: { type: Number, default: 20000 } });
const emit = defineEmits(["imported"]);

const { t } = useI18n();
const headingId = `ami-${useId()}`;
const pasteId = `${headingId}-paste`;
const pasted = ref("");
const preview = ref(null);
const chosen = ref([]);
const reading = ref(false);
const saving = ref(false);
const copied = ref(false);
const error = ref("");

const errorOf = (failure) => t(memoryErrorKey(failure?.response?.data?.code || failure?.data?.code));

const copyPrompt = async () => {
    try {
        await navigator.clipboard.writeText(t("AskMemory.import_prompt"));
        copied.value = true;
    } catch (failure) {
        error.value = t("AskMemory.copy_failed");
    }
};

const read = async () => {
    reading.value = true;
    error.value = "";
    preview.value = null;
    try {
        const res = await apiRequest("post", env.AI_MEMORY_IMPORT_PREVIEW, { text: pasted.value });
        if (!res?.data?.status) throw { data: res?.data };
        const items = res.data.data.items || [];
        preview.value = { items, stripped: Number(res.data.data.stripped) || 0 };
        chosen.value = items.map((item) => item.id);
    } catch (failure) {
        error.value = errorOf(failure);
    } finally {
        reading.value = false;
    }
};

const discard = () => {
    preview.value = null;
    chosen.value = [];
};

const confirm = async () => {
    const items = preview.value.items.filter((item) => chosen.value.includes(item.id)).map(({ kind, text }) => ({ kind, text }));
    if (!items.length) return;
    saving.value = true;
    error.value = "";
    try {
        const res = await apiRequest("post", env.AI_MEMORY_IMPORT_CONFIRM, { items });
        if (!res?.data?.status) throw { data: res?.data };
        emit("imported", res.data.data);
        discard();
        pasted.value = "";
    } catch (failure) {
        error.value = errorOf(failure);
    } finally {
        saving.value = false;
    }
};
</script>

<style>
.ami { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--hairline); min-width: 0; }
.ami__title { margin: 0; font: 600 13px/1.4 var(--font-ui); color: var(--ink); }
.ami__text { margin: 0; }
.ami__copy { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.ami__prompt { flex: 1; min-width: 200px; }
.ami__prompt summary { cursor: pointer; }
.ami__prompt-text { margin: 6px 0 0; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-input); background: var(--surface-2); white-space: pre-line; overflow-wrap: anywhere; }
.ami__off { margin: 0; color: var(--ink-label); }
.ami__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ami__preview { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--hairline); border-radius: var(--r-input); }
.ami__stripped { margin: 0; color: var(--warn-ink); }
.ami__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ami__item { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; min-width: 0; }
.ami__item .ah-check, .ami__item .ah-chip { flex: none; }
.ami__item-text { min-width: 0; overflow-wrap: anywhere; font: var(--text-body); color: var(--ink); }
</style>
