<template>
    <section v-if="settings" class="pdc" data-test="project-dispatcher" :aria-labelledby="ids.heading">
        <h5 :id="ids.heading" class="pdc__title">{{ $t('Dispatcher.title') }}</h5>
        <p class="pdc__hint">{{ $t('Dispatcher.lead') }}</p>
        <div class="pdc__row">
            <label class="pdc__label" :for="ids.mode">{{ $t('Dispatcher.mode_label') }}</label>
            <select :id="ids.mode" v-model="mode" class="pdc__select" data-test="dispatcher-mode" :disabled="!canEdit || busy" @change="save">
                <option v-for="choice in MODES" :key="choice" :value="choice">{{ $t(`Dispatcher.mode_${choice}`) }}</option>
            </select>
        </div>
        <p class="pdc__hint">{{ $t('Dispatcher.counts', { roles: settings.roles.length, rules: settings.rules.length }) }}</p>
        <p v-if="error" class="pdc__error" role="alert">{{ error }}</p>
    </section>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchDispatcher, saveDispatcher } from "@/utils/dispatcher";
import { refusalText } from "@/utils/assignmentRules";

defineOptions({ name: "ProjectDispatcherCard" });

const props = defineProps({
    projectId: { type: String, required: true },
    canEdit: { type: Boolean, default: false }
});

const MODES = ["off", "suggest", "apply"];

const { t } = useI18n();
const uid = `pdc-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading`, mode: `${uid}-mode` };

const settings = ref(null);
const mode = ref("off");
const busy = ref(false);
const error = ref("");

async function load(pid) {
    error.value = "";
    try {
        const data = await fetchDispatcher(pid);
        if (pid !== props.projectId) return;
        settings.value = data?.on ? data.settings : null;
        mode.value = settings.value?.mode || "off";
    } catch (e) {
        settings.value = null;
    }
}

watch(() => props.projectId, (pid) => { if (pid) load(pid); }, { immediate: true });

async function save() {
    if (!settings.value || busy.value) return;
    busy.value = true;
    error.value = "";
    const { roles, rules, threshold, modelGuess } = settings.value;
    try {
        settings.value = await saveDispatcher(props.projectId, { mode: mode.value, roles, rules, threshold, modelGuess });
    } catch (e) {
        mode.value = settings.value.mode;
        error.value = refusalText(e, t("Dispatcher.failed"));
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.pdc { margin-top: 20px; color: var(--ink); font-family: var(--font-ui); }
.pdc__title { margin: 0 0 4px; font-weight: 600; }
.pdc__hint { margin: 0 0 8px; color: var(--ink-2); font-size: var(--fs-sm, 12px); }
.pdc__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
.pdc__label { font-size: var(--fs-md, 12.5px); }
.pdc__select {
    height: 30px;
    max-width: 100%;
    border-radius: var(--r-input, 8px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
}
.pdc__select:focus-visible { outline: none; box-shadow: var(--focus); }
.pdc__error { color: var(--danger); font-size: var(--fs-sm, 12px); }
</style>
