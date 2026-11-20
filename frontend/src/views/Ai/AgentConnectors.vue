<template>
    <section class="ah-card ai-agent agcn" data-test="connectors">
        <div class="ah-label">{{ $t('AgentConnectors.title') }}</div>
        <p class="ai-lead ai-panel__lead">{{ $t('AgentConnectors.lead') }}</p>

        <p v-if="!offered.length" class="ai-ladder__rule" data-test="connectors-none">{{ $t('AgentConnectors.none_offered') }}</p>

        <div v-for="app in offered" :key="app.provider" class="agcn__app" :data-test="`connector-${app.provider}`">
            <label class="agcn__head">
                <input type="checkbox" class="ah-check" :checked="isProviderTicked(modelValue, app.provider)" :disabled="disabled" :data-test="`connector-tick-${app.provider}`" @change="setProvider(app, $event.target.checked)" />
                <span :id="`agcn-${app.provider}`" class="agcn__name">{{ app.name }}</span>
                <span v-if="app.tools.length" class="ah-small agcn__count">{{ $t('AgentConnectors.tools_ticked', { n: toolsTicked(modelValue, app.provider).length - missingTicks(modelValue, app).length, total: app.tools.length }) }}</span>
                <span v-else-if="toolsTicked(modelValue, app.provider).length" class="ah-small agcn__count">{{ $t('AgentConnectors.ticked_unchecked', { n: toolsTicked(modelValue, app.provider).length }) }}</span>
            </label>
            <p v-if="app.status && app.status !== 'ok'" class="ah-small agcn__status" :data-test="`connector-status-${app.provider}`">{{ statusOf(app) }}</p>
            <p v-else-if="app.live" class="ah-small agcn__status">{{ $t('AgentConnectors.live_lead', { app: app.name }) }}</p>
            <ul v-if="missingTicks(modelValue, app).length" class="agcn__missing" :data-test="`connector-missing-${app.provider}`">
                <li v-for="entry in missingTicks(modelValue, app)" :key="entry.key" class="agcn__missrow">
                    <span class="ah-chip ah-chip--sm ah-chip--danger">{{ $t('AgentConnectors.missing') }}</span>
                    <span class="ah-chip ah-chip--mono ah-chip--sm">{{ entry.key }}</span>
                    <span class="ah-small agcn__why">{{ $t(`AgentConnectors.missing_${entry.reason}`, { app: app.name }) }}</span>
                    <button v-if="!disabled" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('AgentConnectors.remove_tick', { tool: entry.key })" :data-test="`connector-remove-${entry.key}`" @click="setTool(app.provider, entry.key, false)">{{ $t('AgentConnectors.remove') }}</button>
                </li>
            </ul>
            <ul class="agcn__tools" role="group" :aria-labelledby="`agcn-${app.provider}`">
                <li v-for="tool in app.tools" :key="tool.key">
                    <label class="agcn__tool">
                        <input type="checkbox" class="ah-check" :checked="toolsTicked(modelValue, app.provider).includes(tool.key)" :disabled="disabled" :data-test="`connector-tool-${tool.key}`" @change="setTool(app.provider, tool.key, $event.target.checked)" />
                        <span class="agcn__label" :title="tool.key">{{ labelOf(tool) }}</span>
                        <span v-if="tool.kind === 'write'" class="ah-chip ah-chip--sm ah-chip--warn" :data-test="`connector-write-${tool.key}`">{{ $t('AgentConnectors.write_needs_approval') }}</span>
                        <span v-else class="ah-chip ah-chip--sm">{{ $t('AgentConnectors.read') }}</span>
                        <span v-if="used.includes(tool.key)" class="ah-chip ah-chip--sm ah-chip--brand" :data-test="`connector-used-${tool.key}`">{{ $t('AgentConnectors.used_by_skills') }}</span>
                    </label>
                </li>
            </ul>
        </div>

        <div v-if="leftOver.length" class="agcn__left" data-test="connectors-not-offered">
            <span class="ah-small">{{ $t('AgentConnectors.not_offered_lead') }}</span>
            <div v-for="entry in leftOver" :key="entry.provider" class="agcn__leftrow">
                <span class="ah-chip ah-chip--mono ah-chip--sm">{{ entry.provider }}</span>
                <span class="ah-small">{{ $t('AgentConnectors.tools_kept', { n: entry.tools.length }) }}</span>
                <button v-if="!disabled" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :data-test="`connector-clear-${entry.provider}`" @click="clear(entry.provider)">{{ $t('AgentConnectors.clear') }}</button>
            </div>
        </div>

        <p class="ai-ladder__rule">{{ $t('AgentConnectors.whose_connection') }}</p>
        <span v-if="hint" class="ah-field__hint">{{ hint }}</span>
    </section>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { isProviderTicked, missingTicks, notOffered, toolsTicked, withProvider, withTool } from "./agentConnectorTicks";

defineOptions({ name: "AgentConnectors" });

const props = defineProps({
    modelValue: { type: Array, default: () => [] },
    offered: { type: Array, default: () => [] },
    used: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
    hint: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const { t, te } = useI18n();

const leftOver = computed(() => notOffered(props.modelValue, props.offered));

// A catalog tool's label is a Connectors.tool.* key; a live tool's is its server's own name, shown as the app wrote it.
const labelOf = (tool) => {
    if (tool.live) return tool.label;
    return tool.label && te(tool.label) ? t(tool.label) : tool.description;
};

const STATUSES = ["not_connected", "not_member", "broken", "app_off", "unreachable"];
const statusOf = (app) => t(`AgentConnectors.status_${STATUSES.includes(app.status) ? app.status : "unavailable"}`, { app: app.name });

const setProvider = (app, on) => emit("update:modelValue", withProvider(props.modelValue, app, on));
const setTool = (provider, key, on) => emit("update:modelValue", withTool(props.modelValue, provider, key, on));
const clear = (provider) => emit("update:modelValue", withProvider(props.modelValue, { provider, tools: [] }, false));
</script>

<style>
.agcn__app { padding: 10px 0; border-bottom: 1px solid var(--hairline); }
.agcn__head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; cursor: pointer; }
.agcn__name { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.agcn__count { color: var(--ink-2); }
.agcn__tools { list-style: none; margin: 6px 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.agcn__tool { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 4px 6px; border-radius: var(--r-chip); cursor: pointer; font: var(--text-small); color: var(--ink); }
.agcn__tool:hover { background: var(--surface-hover); }
.agcn__label { min-width: 0; }
.agcn__status { margin: 4px 0 0 24px; color: var(--ink-2); }
.agcn__missing { list-style: none; margin: 6px 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.agcn__missrow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.agcn__why { color: var(--ink-2); }
.agcn__left { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.agcn__leftrow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
</style>
