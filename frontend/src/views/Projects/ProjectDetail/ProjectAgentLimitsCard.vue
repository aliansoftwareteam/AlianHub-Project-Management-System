<template>
    <section class="pal" data-test="project-agent-limits" :aria-labelledby="ids.heading">
        <h5 :id="ids.heading" class="pal__title">{{ $t('AgentLimits.title') }}</h5>
        <p class="pal__hint">{{ $t('AgentLimits.lead') }}</p>
        <p v-if="loading" class="pal__hint" data-test="loading">{{ $t('AgentLimits.loading') }}</p>
        <template v-else-if="loaded">
            <div class="pal__row">
                <label class="pal__label" :for="ids.atOnce">{{ $t('AgentLimits.at_once_label') }}</label>
                <select
                    :id="ids.atOnce"
                    v-model.number="draft.atOnce"
                    class="pal__select"
                    data-test="at-once"
                    :disabled="!canEdit || busy"
                    :aria-describedby="ids.atOnceAbout"
                    @change="save('atOnce')"
                >
                    <option v-for="count in counts" :key="count" :value="count">{{ count }}</option>
                </select>
            </div>
            <p :id="ids.atOnceAbout" class="pal__hint">{{ $t('AgentLimits.at_once_about') }}</p>

            <p v-if="saved.paused" class="pal__note" role="status" data-test="paused-note">{{ $t('AgentLimits.paused_note') }}</p>
            <div v-if="canEdit" class="pal__row">
                <button v-if="saved.paused" type="button" class="pal__button" data-test="resume" :disabled="busy" @click="setPaused(false)">
                    {{ $t('AgentLimits.resume') }}
                </button>
                <button v-else type="button" class="pal__button" data-test="pause" :disabled="busy" @click="setPaused(true)">
                    {{ $t('AgentLimits.pause') }}
                </button>
                <span class="pal__hint pal__grow">{{ $t(saved.paused ? 'AgentLimits.resume_about' : 'AgentLimits.pause_about') }}</span>
            </div>
            <p v-else class="pal__hint" data-test="read-only">{{ $t('AgentLimits.read_only') }}</p>
        </template>
        <p v-if="error" class="pal__error" role="alert" data-test="error">{{ error }}</p>
    </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "ProjectAgentLimitsCard" });

const props = defineProps({
    projectId: { type: String, required: true }
});

const { t } = useI18n();
const $toast = useToast();

const uid = `pal-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading`, atOnce: `${uid}-at-once`, atOnceAbout: `${uid}-at-once-about` };

const draft = reactive({ atOnce: 0, paused: false });
const saved = reactive({ atOnce: 0, paused: false });
const range = reactive({ min: 1, max: 1 });
const canEdit = ref(false);
const loading = ref(false);
const loaded = ref(false);
const busy = ref(false);
const error = ref("");

const counts = computed(() => Array.from({ length: Math.max(0, range.max - range.min + 1) }, (_, index) => range.min + index));

const urlOf = (pid) => `${env.AGENT_PROJECT_LIMITS}/${encodeURIComponent(pid)}`;
const reasonOf = (e, fallback) => e?.response?.data?.statusText || e?.response?.data?.message || t(fallback);

function take(data) {
    Object.assign(saved, data.limits);
    Object.assign(draft, data.limits);
    Object.assign(range, data.atOnceRange);
    canEdit.value = data.canEdit === true;
}

async function request(type, pid, body, fallback) {
    let res;
    try {
        res = await apiRequest(type, urlOf(pid), body);
    } catch (e) {
        throw new Error(reasonOf(e, fallback));
    }
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t(fallback));
    return res.data.data;
}

async function load(pid) {
    loading.value = true;
    loaded.value = false;
    error.value = "";
    try {
        const data = await request("get", pid, undefined, "AgentLimits.load_failed");
        if (pid !== props.projectId) return;
        take(data);
        loaded.value = true;
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
}

watch(() => props.projectId, (pid) => { if (pid) load(pid); }, { immediate: true });

async function save(key) {
    busy.value = true;
    error.value = "";
    try {
        take(await request("put", props.projectId, { [key]: draft[key] }, "AgentLimits.save_failed"));
        $toast.success(t("AgentLimits.saved"), { position: "top-right" });
    } catch (e) {
        draft[key] = saved[key];
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}

function setPaused(paused) {
    draft.paused = paused;
    return save("paused");
}
</script>

<style scoped>
.pal { display: flex; flex-direction: column; gap: 8px; margin: 20px 0 0; max-width: 560px; min-width: 0; }
.pal__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.pal__hint { margin: 0; color: var(--ink-2); font-size: 12px; overflow-wrap: anywhere; }
.pal__grow { flex: 1 1 200px; min-width: 0; }
.pal__note { margin: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-input, 8px); background: var(--fill); color: var(--ink); font-size: 12px; }
.pal__error { margin: 0; color: var(--danger); font-size: 12px; }
.pal__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
.pal__label { margin: 0; font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.pal__select,
.pal__button {
    min-height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--r-input, 8px);
    background: var(--surface); color: var(--ink); font: 500 12.5px/1.3 var(--font-ui);
}
.pal__button { cursor: pointer; }
.pal__button:hover:not(:disabled) { background: var(--fill); }
.pal__select:disabled,
.pal__button:disabled { cursor: default; opacity: 0.6; }
.pal__select:focus-visible,
.pal__button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
