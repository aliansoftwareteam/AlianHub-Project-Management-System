<template>
    <section class="pmc" data-test="project-manager" :aria-labelledby="ids.heading">
        <h5 :id="ids.heading" class="pmc__title">{{ $t('ProjectManager.title') }}</h5>
        <p class="pmc__hint">{{ $t('ProjectManager.lead') }}</p>
        <p v-if="loading" class="pmc__hint" data-test="loading">{{ $t('ProjectManager.loading') }}</p>
        <template v-else-if="loaded">
            <div class="pmc__row">
                <AhSwitch
                    :model-value="on"
                    :disabled="!canEdit || busy"
                    :label="$t('ProjectManager.switch_label')"
                    data-test="manager-switch"
                    @update:model-value="save"
                />
                <span class="pmc__name">{{ $t('ProjectManager.switch_label') }}</span>
            </div>
            <p class="pmc__hint" data-test="manager-level">
                <span class="pmc__label">{{ $t('ProjectManager.level_label') }}</span> {{ $t(`ProjectManager.level_${level}`) }}
            </p>
            <p v-if="!canEdit" class="pmc__hint" data-test="read-only">{{ $t('ProjectManager.read_only') }}</p>

            <div v-if="on" class="pmc__findings" data-test="findings">
                <h6 class="pmc__subtitle">{{ $t('ProjectManager.findings_title') }}</h6>
                <p v-if="!findings.length" class="pmc__hint" data-test="findings-empty">{{ $t('ProjectManager.empty') }}</p>
                <ul v-else class="pmc__list">
                    <li v-for="finding in findings" :key="finding.id" class="pmc__finding" data-test="finding" :data-rule="finding.rule">
                        <div class="pmc__head">
                            <span class="ah-chip">{{ $t(`ProjectManager.rule_${finding.rule}`) }}</span>
                            <span class="pmc__subject">{{ subjectOf(finding) }}</span>
                        </div>
                        <p class="pmc__reason">
                            <span v-for="(reason, i) in reasonsOf(finding)" :key="i" class="pmc__sentence">{{ reason }}</span>
                        </p>
                        <p class="pmc__offer">
                            <span>{{ offerOf(finding) }}</span>
                            <RouterLink
                                v-if="finding.canDecide && finding.proposalId"
                                class="pmc__review"
                                data-test="finding-review"
                                :to="{ name: 'inbox', params: { cid: route.params.cid }, query: { tab: 'approval' } }"
                            >{{ $t('ProjectManager.review') }}</RouterLink>
                        </p>
                    </li>
                </ul>
            </div>
        </template>
        <p v-if="error" class="pmc__error" role="alert" data-test="error">{{ error }}</p>
    </section>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import { useGetterFunctions } from "@/composable";
import * as env from "@/config/env";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import { findingOffer, findingReasons } from "./findingText";

defineOptions({ name: "ProjectManagerCard" });

const props = defineProps({
    projectId: { type: String, required: true }
});

const { t } = useI18n();
const route = useRoute();
const $toast = useToast();
const { getUser } = useGetterFunctions();

const uid = `pmc-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading` };

const on = ref(false);
const level = ref("suggest");
const findings = ref([]);
const canEdit = ref(false);
const loading = ref(false);
const loaded = ref(false);
const busy = ref(false);
const error = ref("");

const urlOf = (pid) => `${env.AGENT_PROJECT_MANAGER}/${encodeURIComponent(pid)}`;
const reasonOf = (e, fallback) => e?.response?.data?.statusText || e?.response?.data?.message || t(fallback);

const reasonsOf = (finding) => findingReasons(t, finding);
const offerOf = (finding) => findingOffer(t, finding);
const taskLine = (facts) => [facts?.taskKey, facts?.taskName].filter(Boolean).join(" ");
const subjectOf = (finding) => (finding.rule === "overloaded"
    ? getUser(finding.userId)?.Employee_Name || t("ProjectManager.someone")
    : taskLine(finding.facts));

function take(data) {
    on.value = data.on === true;
    level.value = data.level || "suggest";
    findings.value = Array.isArray(data.findings) ? data.findings : [];
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
        const data = await request("get", pid, undefined, "ProjectManager.load_failed");
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

async function save(next) {
    busy.value = true;
    error.value = "";
    try {
        take(await request("put", props.projectId, { on: next }, "ProjectManager.save_failed"));
        $toast.success(t(next ? "ProjectManager.turned_on" : "ProjectManager.turned_off"), { position: "top-right" });
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.pmc { display: flex; flex-direction: column; gap: 8px; margin: 20px 0 0; max-width: 560px; min-width: 0; }
.pmc__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.pmc__subtitle { margin: 4px 0 0; font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.pmc__hint { margin: 0; color: var(--ink-2); font-size: 12px; overflow-wrap: anywhere; }
.pmc__label { color: var(--ink); font-weight: 600; }
.pmc__error { margin: 0; color: var(--danger); font-size: 12px; }
.pmc__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pmc__name { color: var(--ink); font: 500 12.5px/1.35 var(--font-ui); min-width: 0; overflow-wrap: anywhere; }
.pmc__findings { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pmc__list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; min-width: 0; }
.pmc__finding {
    display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; min-width: 0;
    border: 1px solid var(--border); border-radius: var(--r-input, 8px); background: var(--surface);
}
.pmc__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.pmc__subject { color: var(--ink); font: 500 12.5px/1.35 var(--font-ui); min-width: 0; overflow-wrap: anywhere; }
.pmc__reason { display: flex; flex-direction: column; gap: 2px; margin: 0; color: var(--ink); font: 400 12px/1.4 var(--font-ui); overflow-wrap: anywhere; }
.pmc__offer { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin: 0; color: var(--ink-2); font: 400 12px/1.4 var(--font-ui); overflow-wrap: anywhere; }
.pmc__review { color: var(--brand); font-weight: 600; text-decoration: none; }
.pmc__review:hover { text-decoration: underline; }
.pmc__review:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
