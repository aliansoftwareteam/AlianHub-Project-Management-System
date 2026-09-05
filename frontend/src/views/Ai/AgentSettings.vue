<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <router-link class="ah-btn ah-btn--ghost ah-btn--sm" :to="{ name: 'AiHub', params: { cid: companyId } }">
                    <ShellIcon name="chevronLeft" :size="14" />{{ $t('Ai.agents') }}
                </router-link>
                <div class="ah-toolbar__title">
                    <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                    <span>{{ agent.name || $t('Ai.agent') }}</span>
                </div>
                <div class="ah-toolbar__spacer"></div>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="stop">{{ $t('Ai.stop_agent') }}</button>
            </div>

            <div class="ai-page__body ah-scroll">
                <div v-if="loadingAgent" class="ah-empty">{{ $t('Ai.loading') }}</div>
                <template v-else>
                    <section class="ah-card ai-agent">
                        <div class="ah-label">{{ $t('Ai.skills_actions') }}</div>
                        <p class="ai-lead" style="margin:6px 0 12px">{{ $t('Ai.skills_lead') }}</p>

                        <div v-for="skill in skills" :key="skill.key" class="ai-skill">
                            <div class="ai-skill__head">
                                <input :id="`sk-${skill.key}`" v-model="skill.enabled" type="checkbox" class="ah-check" />
                                <label :for="`sk-${skill.key}`" class="ai-skill__name">{{ skill.name }}</label>
                                <span v-if="!skill.enabled" class="ah-chip">{{ $t('Ai.off') }}</span>
                            </div>
                            <div class="ai-skill__actions">
                                <span v-for="a in skill.actions" :key="a" class="ah-chip ah-chip--mono">{{ a }}</span>
                            </div>
                        </div>

                        <p class="ai-never">
                            <strong>{{ $t('Ai.never_label') }}</strong>
                            <span class="ah-mono">{{ never }}</span>
                            <span class="ah-small">{{ $t('Ai.never_note') }}</span>
                        </p>
                    </section>

                    <section class="ah-card ai-agent">
                        <div class="ah-label">{{ $t('Ai.autonomy') }}</div>
                        <div class="ai-radios">
                            <label v-for="step in AUTONOMY.slice(0, 4)" :key="step.level" class="ai-radio" :class="{ 'is-on': form.autonomy === step.level }">
                                <input v-model.number="form.autonomy" type="radio" :value="step.level" class="ah-check" />
                                <span><strong>{{ step.key }}</strong> · {{ $t(`Ai.autonomy_${step.level}`) }}</span>
                            </label>
                        </div>
                        <p class="ai-ladder__rule">{{ $t('Ai.low_risk_note') }}</p>

                        <div class="ai-preview" data-test="l2-preview">
                            <div class="ah-label">{{ $t('Ai.l2_preview_title') }}</div>
                            <p class="ai-lead" style="margin:6px 0 10px">{{ $t('Ai.l2_preview_lead') }}</p>
                            <div class="ai-preview__cols">
                                <div class="ai-preview__col" data-test="l2-acts">
                                    <span class="ah-chip ah-chip--ok">{{ $t('Ai.l2_acts') }}</span>
                                    <p v-if="!preview.acts.length" class="ah-small ai-preview__none">{{ $t('Ai.l2_none_act') }}</p>
                                    <ul v-else class="ai-preview__list">
                                        <li v-for="item in preview.acts" :key="item.key"><span class="ah-mono">{{ item.key }}</span><span class="ah-small">{{ $t(`Ai.l2_reason_${item.reason}`) }}</span></li>
                                    </ul>
                                </div>
                                <div class="ai-preview__col" data-test="l2-proposes">
                                    <span class="ah-chip ah-chip--warn">{{ $t('Ai.l2_proposes') }}</span>
                                    <p v-if="!preview.proposes.length" class="ah-small ai-preview__none">{{ $t('Ai.l2_none_propose') }}</p>
                                    <ul v-else class="ai-preview__list">
                                        <li v-for="item in preview.proposes" :key="item.key"><span class="ah-mono">{{ item.key }}</span><span class="ah-small">{{ $t(`Ai.l2_reason_${item.reason}`) }}</span></li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="ah-card ai-agent">
                        <div class="ah-label">{{ $t('Ai.runs_limits') }}</div>
                        <p class="ai-lead" style="margin:6px 0 0">{{ $t('Ai.runs_manual_note') }}</p>
                        <div class="ai-fields">
                            <div class="ah-field">
                                <label class="ah-field__label" for="rate">{{ $t('Ai.rate_limit') }}</label>
                                <input id="rate" v-model.number="form.rateLimitPerDay" type="number" min="1" max="500" class="ah-input" />
                            </div>
                            <div class="ah-field">
                                <label class="ah-field__label" for="cap">{{ $t('Ai.spend_cap') }}</label>
                                <input id="cap" v-model.number="form.spendCapUsd" type="number" min="0" step="1" class="ah-input" />
                                <span class="ah-field__hint">{{ $t('Ai.cap_hint') }}</span>
                            </div>
                        </div>
                        <p v-if="spendRow" class="ai-ladder__rule ah-mono">{{ $t('Ai.spent_this_month', { usd: spendRow.usd.toFixed(2), runs: spendRow.runs }) }}</p>
                    </section>

                    <section class="ah-card ai-agent">
                        <div class="ah-label">{{ $t('Ai.recent_audit') }}</div>
                        <div v-if="!recentRuns.length" class="ah-empty" style="margin-top:8px">{{ $t('Ai.no_runs') }}</div>
                        <ul v-else class="ai-audit">
                            <li v-for="run in recentRuns" :key="run._id" class="ai-audit__item">
                                <div class="ai-audit__row">
                                    <span class="ah-mono ai-audit__at">{{ time(run.startedAt) }}</span>
                                    <span class="ai-audit__what">{{ run.skill || run.trigger || $t('Ai.run') }}</span>
                                    <span class="ah-chip" :class="runChip(run)">{{ run.status }}</span>
                                    <span v-if="run.revertedAt" class="ah-chip ah-chip--dark">{{ $t('Ai.reverted_chip') }}</span>
                                    <span v-if="refusalCount(run)" class="ah-chip ah-chip--warn">{{ $t('Ai.refused_n', { n: refusalCount(run) }) }}</span>
                                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="toggleRun(run._id)">{{ expandedRun === run._id ? $t('Ai.hide_details') : $t('Ai.run_details') }}</button>
                                </div>
                                <AgentRunDetail v-if="expandedRun === run._id" :run-id="run._id" @reverted="reloadRuns" />
                            </li>
                        </ul>
                    </section>

                    <div v-if="error" class="ah-field__error">{{ error }}</div>
                    <div class="ai-actions">
                        <button type="button" class="ah-btn ah-btn--primary" :disabled="busy" @click="save">{{ busy ? $t('Ai.saving') : $t('Ai.save') }}</button>
                        <router-link class="ah-btn ah-btn--secondary" :to="{ name: 'AiHub', params: { cid: companyId } }">{{ $t('Ai.cancel') }}</router-link>
                    </div>

                    <section class="ah-card ai-agent ai-danger">
                        <div class="ah-label">{{ $t('Ai.delete_agent') }}</div>
                        <p class="ai-lead" style="margin:6px 0 10px">{{ openRunCount ? $t('Ai.delete_blocked_running', { n: openRunCount }) : $t('Ai.delete_body') }}</p>
                        <div v-if="!openRunCount" class="ai-fields">
                            <div class="ah-field">
                                <label class="ah-field__label" for="del-confirm">{{ $t('Ai.delete_confirm_label', { name: agent.name }) }}</label>
                                <input id="del-confirm" v-model.trim="deleteConfirm" type="text" class="ah-input" autocomplete="off" />
                            </div>
                        </div>
                        <div class="ai-actions">
                            <button type="button" class="ah-btn ah-btn--danger" :disabled="busy || Boolean(openRunCount) || deleteConfirm !== agent.name" @click="remove">{{ $t('Ai.delete_agent') }}</button>
                        </div>
                    </section>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiSidebar from "./AiSidebar.vue";
import AgentRunDetail from "./AgentRunDetail.vue";
import { useAgents, refusalCount } from "./useAgents";
import { splitPreview } from "./policyPreview";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "AgentSettingsPage" });

const { t } = useI18n();
const $toast = useToast();
const route = useRoute();
const router = useRouter();
const companyId = inject("$companyId");
const { agents, spend, registryManifest, loadAgents, loadSpend, loadRegistry, saveAgent, setPaused, deleteAgent, activeRuns, loadActiveRuns } = useAgents();

const loadingAgent = ref(true);
const busy = ref(false);
const error = ref("");
const agent = ref({});
const skills = ref([]);
const recentRuns = ref([]);
const deleteConfirm = ref("");
const form = reactive({ autonomy: 1, rateLimitPerDay: 40, spendCapUsd: 30 });
const openRunCount = computed(() => (activeRuns.value[String(route.params.id)] || []).length);

const AUTONOMY = computed(() => (registryManifest.value.autonomy || []).map((a) => ({ level: a.level, key: `L${a.level}` })));
const never = computed(() => (registryManifest.value.never || []).join(" · "));
const spendRow = computed(() => (spend.value.agents || []).find((a) => a.agentId === String(route.params.id)));
const expandedRun = ref("");

const allowedKeys = computed(() => {
    const keys = new Set();
    skills.value.filter((s) => s.enabled).forEach((s) => (s.actions || []).forEach((a) => keys.add(a)));
    if (!keys.size) (agent.value.allowedActions || []).forEach((a) => keys.add(a));
    return [...keys];
});
const preview = computed(() => splitPreview(allowedKeys.value, registryManifest.value.actions));

const time = (at) => (at ? moment(at).format("HH:mm") : "");
const runChip = (run) => (run.status === "failed" ? "ah-chip--danger" : run.status === "running" ? "ah-chip--brand" : run.status === "skipped" ? "ah-chip--warn" : "ah-chip--ok");
const toggleRun = (id) => { expandedRun.value = expandedRun.value === id ? "" : id; };

const reloadRuns = async () => {
    const res = await apiRequest("get", `${env.AGENT_RUNS}?agentId=${route.params.id}&limit=5`);
    if (res?.data?.status) recentRuns.value = res.data.data || [];
};

const load = async () => {
    await Promise.all([loadAgents(), loadSpend(), loadRegistry(), loadActiveRuns()]);
    const found = agents.value.find((a) => String(a._id) === String(route.params.id));
    if (!found) {
        router.replace({ name: "AiHub", params: { cid: companyId.value } });
        return;
    }
    agent.value = found;
    form.autonomy = Number(found.autonomy ?? 1);
    form.rateLimitPerDay = Number(found.rateLimitPerDay || 40);
    form.spendCapUsd = Number(found.spendCapUsd || 30);
    skills.value = (found.skills || []).map((s) => ({
        key: s.key || String(s),
        name: s.name || s.key || String(s),
        actions: s.actions || found.allowedActions || [],
        enabled: s.enabled !== false
    }));

    await reloadRuns();
    loadingAgent.value = false;
};

const save = async () => {
    busy.value = true;
    error.value = "";
    try {
        await saveAgent({
            _id: agent.value._id,
            autonomy: form.autonomy,
            rateLimitPerDay: form.rateLimitPerDay,
            spendCapUsd: form.spendCapUsd,
            skills: skills.value.map((s) => ({ key: s.key, name: s.name, actions: s.actions, enabled: s.enabled }))
        });
        $toast.success(t("Ai.saved"), { position: "top-right" });
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
};

const stop = async () => {
    busy.value = true;
    try {
        await setPaused(agent.value._id, true);
        $toast.success(t("Ai.stopped"), { position: "top-right" });
        router.push({ name: "AiHub", params: { cid: companyId.value } });
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    } finally {
        busy.value = false;
    }
};

const remove = async () => {
    busy.value = true;
    try {
        await deleteAgent(agent.value._id);
        $toast.success(t("Ai.deleted", { name: agent.value.name }), { position: "top-right" });
        router.push({ name: "AiHub", params: { cid: companyId.value } });
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style>
@import "./style.css";
.ai-skill { padding: 11px 0; border-bottom: 1px solid var(--hairline); }
.ai-skill:last-of-type { border-bottom: 0; }
.ai-skill__head { display: flex; align-items: center; gap: 9px; }
.ai-skill__name { font: 600 13px/1.2 var(--font-ui); cursor: pointer; }
.ai-skill__actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 7px 0 0 24px; }
.ai-never { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--hairline); font: var(--text-small); color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
.ai-never strong { color: var(--ink); }
.ai-radios { display: flex; flex-direction: column; gap: 7px; margin: 8px 0 10px; }
.ai-radio { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: 1.5px solid var(--border); border-radius: 9px; cursor: pointer; font: var(--text-body); }
.ai-radio.is-on { border-color: var(--brand); background: var(--brand-tint); }
.ai-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 10px; }
.ai-preview { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--hairline); }
.ai-preview__cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.ai-preview__col { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.ai-preview__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; width: 100%; }
.ai-preview__list li { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.ai-preview__list .ah-small { color: var(--ink-2); }
.ai-preview__none { margin: 0; color: var(--ink-2); }
.ai-audit { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ai-audit__item { display: flex; flex-direction: column; }
.ai-audit__row { display: flex; align-items: center; gap: 10px; font: var(--text-small); flex-wrap: wrap; }
.ai-audit__at { color: var(--ink-3); }
.ai-audit__what { flex: 1; min-width: 0; color: var(--ink); }
.ai-danger { border-color: var(--danger-ink, #b42318); }
</style>
