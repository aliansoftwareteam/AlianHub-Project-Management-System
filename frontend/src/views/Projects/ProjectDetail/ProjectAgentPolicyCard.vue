<template>
    <section class="pap" data-test="project-agent-policy" :aria-labelledby="ids.heading">
        <h5 :id="ids.heading" class="pap__title">{{ $t('AgentPolicy.title') }}</h5>
        <p class="pap__hint">{{ $t('AgentPolicy.lead') }}</p>
        <p v-if="loading" class="pap__hint" data-test="loading">{{ $t('AgentPolicy.loading') }}</p>
        <template v-else-if="loaded">
            <p v-if="workspaceChecks" class="pap__note" data-test="workspace-wins">{{ $t('AgentPolicy.workspace_wins') }}</p>
            <fieldset v-for="group in GROUPS" :key="group.key" class="pap__group" :disabled="!canEdit || busy" :data-test="`group-${group.key}`">
                <legend class="pap__legend">{{ $t(group.label) }}</legend>
                <label v-for="option in group.options" :key="option.value" class="pap__option" :class="{ 'is-on': draft[group.key] === option.value }">
                    <input
                        v-model="draft[group.key]"
                        type="radio"
                        class="pap__radio"
                        :name="`${uid}-${group.key}`"
                        :value="option.value"
                        :data-test="`${group.key}-${option.value}`"
                        @change="save(group.key)"
                    />
                    <span class="pap__text">
                        <span class="pap__name">{{ $t(option.name) }}</span>
                        <span class="pap__about">{{ $t(option.about) }}</span>
                    </span>
                </label>
            </fieldset>
            <p v-if="!canEdit" class="pap__hint" data-test="read-only">{{ $t('AgentPolicy.read_only') }}</p>
        </template>
        <p v-if="error" class="pap__error" role="alert" data-test="error">{{ error }}</p>
    </section>
</template>

<script setup>
import { reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "ProjectAgentPolicyCard" });

const props = defineProps({
    projectId: { type: String, required: true }
});

const GROUPS = [
    {
        key: "done",
        label: "AgentPolicy.done_label",
        options: [
            { value: "never", name: "AgentPolicy.done_never", about: "AgentPolicy.done_never_about" },
            { value: "approval", name: "AgentPolicy.done_approval", about: "AgentPolicy.done_approval_about" },
            { value: "yes", name: "AgentPolicy.done_yes", about: "AgentPolicy.done_yes_about" }
        ]
    },
    {
        key: "connected",
        label: "AgentPolicy.connected_label",
        options: [
            { value: "propose_all", name: "AgentPolicy.connected_propose_all", about: "AgentPolicy.connected_propose_all_about" },
            { value: "single_task", name: "AgentPolicy.connected_single_task", about: "AgentPolicy.connected_single_task_about" }
        ]
    }
];

const { t } = useI18n();
const $toast = useToast();

const uid = `pap-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading` };

const draft = reactive({ done: "", connected: "" });
const saved = reactive({ done: "", connected: "" });
const canEdit = ref(false);
const workspaceChecks = ref(false);
const loading = ref(false);
const loaded = ref(false);
const busy = ref(false);
const error = ref("");

const urlOf = (pid) => `${env.AGENT_PROJECT_POLICY}/${encodeURIComponent(pid)}`;
const reasonOf = (e, fallback) => e?.response?.data?.statusText || e?.response?.data?.message || t(fallback);

function take(data) {
    Object.assign(saved, data.project);
    Object.assign(draft, data.project);
    canEdit.value = data.canEdit === true;
    workspaceChecks.value = data.workspaceChecksBeforeDone === true;
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
        const data = await request("get", pid, undefined, "AgentPolicy.load_failed");
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
        take(await request("put", props.projectId, { [key]: draft[key] }, "AgentPolicy.save_failed"));
        $toast.success(t("AgentPolicy.saved"), { position: "top-right" });
    } catch (e) {
        draft[key] = saved[key];
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.pap { display: flex; flex-direction: column; gap: 8px; margin: 20px 0 0; max-width: 560px; min-width: 0; }
.pap__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.pap__hint { margin: 0; color: var(--ink-2); font-size: 12px; }
.pap__note { margin: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-input, 8px); background: var(--fill); color: var(--ink); font-size: 12px; }
.pap__error { margin: 0; color: var(--danger); font-size: 12px; }
.pap__group { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 0; padding: 0; border: 0; min-width: 0; }
.pap__legend { padding: 0; margin: 0 0 2px; font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.pap__option {
    display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 10px; min-width: 0;
    border: 1px solid var(--border); border-radius: var(--r-input, 8px); background: var(--surface); cursor: pointer;
}
.pap__option.is-on { border-color: var(--brand); background: var(--brand-tint); }
.pap__group:disabled .pap__option { cursor: default; }
.pap__radio { flex: none; margin: 2px 0 0; accent-color: var(--brand); }
.pap__radio:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.pap__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pap__name { color: var(--ink); font: 500 12.5px/1.35 var(--font-ui); overflow-wrap: anywhere; }
.pap__about { color: var(--ink-2); font: 400 12px/1.4 var(--font-ui); overflow-wrap: anywhere; }
</style>
