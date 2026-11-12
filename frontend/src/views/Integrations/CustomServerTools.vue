<template>
    <section class="cst" :aria-labelledby="`cst-title-${server.serverId}`" data-test="custom-server-tools">
        <div :id="`cst-title-${server.serverId}`" class="cst__title">{{ $t('Connectors.custom.tools_title', { name: server.name }) }}</div>
        <p class="ah-small cst__lead">{{ $t('Connectors.custom.tools_lead') }}</p>

        <p v-if="loadError" class="ah-field__error" role="alert" data-test="cst-load-error">{{ loadError }}</p>
        <p v-else-if="!loading && !tools.length" class="ah-small" data-test="cst-empty">{{ $t('Connectors.custom.tools_empty') }}</p>

        <article v-for="tool in tools" :key="tool.tool" class="cst__tool" :data-test="`cst-tool-${tool.tool}`">
            <div class="cst__head">
                <strong class="cst__name ah-mono">{{ tool.tool }}</strong>
                <span class="ah-chip ah-chip--sm" :class="stateClass(tool.review.state)">{{ $t(`Connectors.custom.state_${tool.review.state}`) }}</span>
            </div>

            <div class="cst__outside" :aria-label="$t('Connectors.custom.outside_label')">
                <div class="cst__outside-head">
                    <span class="ah-chip ah-chip--warn ah-chip--sm">{{ $t('Connectors.custom.outside_label') }}</span>
                    <span class="ah-small cst__note">{{ $t('Connectors.custom.outside_note') }}</span>
                </div>
                <p class="cst__outside-text">{{ tool.outside.description }}</p>
                <details v-if="tool.outside.inputSchema">
                    <summary class="ah-small">{{ $t('Connectors.custom.outside_takes') }}</summary>
                    <pre class="cst__takes ah-mono">{{ pretty(tool.outside.inputSchema) }}</pre>
                </details>
            </div>

            <p v-if="!tool.usable" class="ah-small cst__warn">{{ $t('Connectors.custom.not_usable') }}</p>

            <form class="cst__form" novalidate @submit.prevent="save(tool)">
                <label class="cst__toggle">
                    <input v-model="drafts[tool.tool].enabled" type="checkbox" class="ah-check" :disabled="busy === tool.tool || !tool.usable" :data-test="`cst-on-${tool.tool}`" />
                    <span>{{ $t('Connectors.custom.turn_on') }}</span>
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.access') }}</span>
                    <select v-model="drafts[tool.tool].access" class="ah-input" :disabled="busy === tool.tool" :data-test="`cst-access-${tool.tool}`">
                        <option value="read">{{ $t('Connectors.custom.access_read') }}</option>
                        <option value="write">{{ $t('Connectors.custom.access_write') }}</option>
                    </select>
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.tool_label') }}</span>
                    <input v-model="drafts[tool.tool].label" class="ah-input" type="text" maxlength="80" :disabled="busy === tool.tool" />
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.tool_description') }}</span>
                    <textarea v-model="drafts[tool.tool].description" class="ah-input cst__textarea" rows="3" maxlength="500" :disabled="busy === tool.tool"></textarea>
                </label>
                <p v-if="errors[tool.tool]" class="ah-field__error" role="alert">{{ errors[tool.tool] }}</p>
                <div class="cst__actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy === tool.tool" :data-test="`cst-save-${tool.tool}`">
                        {{ busy === tool.tool ? $t('Connectors.custom.saving') : $t('Connectors.custom.save_tool') }}
                    </button>
                    <span v-if="saved === tool.tool" class="ah-small" role="status">{{ $t('Connectors.custom.tool_saved') }}</span>
                </div>
            </form>
        </article>
    </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "CustomServerTools" });

const props = defineProps({
    server: { type: Object, required: true },
});

const { t } = useI18n();

const tools = ref([]);
const drafts = reactive({});
const errors = reactive({});
const loading = ref(true);
const loadError = ref("");
const busy = ref("");
const saved = ref("");

const base = () => `${env.CONNECTORS}/servers/${props.server.serverId}/tools`;
const pretty = (schema) => JSON.stringify(schema, null, 2);
const stateClass = (state) => (state === "reviewed" ? "ah-chip--ok" : state === "changed" ? "ah-chip--warn" : "ah-chip--brand");

const draftOf = (tool) => ({ enabled: tool.review.enabled, access: tool.review.access, label: tool.review.label, description: tool.review.description });

const apply = (list) => {
    tools.value = list;
    list.forEach((tool) => {
        drafts[tool.tool] = draftOf(tool);
        errors[tool.tool] = "";
    });
};

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", base());
        if (!res?.data?.status) { loadError.value = res?.data?.statusText || t("Connectors.custom.tools_failed"); return; }
        apply(res.data.data.tools || []);
    } catch (e) {
        loadError.value = e?.response?.data?.statusText || t("Connectors.custom.tools_failed");
    } finally {
        loading.value = false;
    }
};

const save = async (tool) => {
    busy.value = tool.tool;
    saved.value = "";
    errors[tool.tool] = "";
    try {
        const res = await apiRequest("put", `${base()}/${encodeURIComponent(tool.tool)}`, { ...drafts[tool.tool], shape: tool.shape });
        if (!res?.data?.status) { errors[tool.tool] = res?.data?.statusText || t("Connectors.custom.tool_failed"); return; }
        const next = res.data.data.tool;
        tools.value = tools.value.map((item) => (item.tool === next.tool ? next : item));
        drafts[next.tool] = draftOf(next);
        saved.value = next.tool;
    } catch (e) {
        errors[tool.tool] = e?.response?.data?.statusText || t("Connectors.custom.tool_failed");
    } finally {
        busy.value = "";
    }
};

onMounted(load);
</script>

<style scoped>
.cst { display: flex; flex-direction: column; gap: 10px; padding-top: 6px; }
.cst__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.cst__lead { margin: 0; color: var(--ink-2); }
.cst__tool { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.cst__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cst__name { color: var(--ink); overflow-wrap: anywhere; }
.cst__outside { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px dashed var(--border); border-radius: var(--r-input); background: var(--surface-2); }
.cst__outside-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cst__note { color: var(--ink-2); }
.cst__outside-text { margin: 0; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.cst__takes { margin: 6px 0 0; max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); }
.cst__warn { margin: 0; color: var(--warn-ink); }
.cst__form { display: flex; flex-direction: column; gap: 8px; }
.cst__toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--ink); }
.cst__textarea { min-height: 64px; resize: vertical; }
.cst__actions { display: flex; align-items: center; gap: 8px; }
</style>
