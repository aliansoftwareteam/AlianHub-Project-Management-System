<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Ai.agents') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="creating = true">
                    <ShellIcon name="plus" :size="14" />{{ $t('Ai.new_agent') }}
                </button>
            </div>

            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('Ai.hub_lead') }}</p>

                <div v-if="lastError" class="ah-empty">{{ lastError }}</div>
                <div v-else-if="loading" class="ah-empty">{{ $t('Ai.loading') }}</div>

                <div v-else-if="!agents.length" class="ah-card ai-agent">
                    <h3 class="ah-h3">{{ $t('Ai.empty_title') }}</h3>
                    <p class="ai-lead" style="margin:6px 0 12px">{{ $t('Ai.empty_body') }}</p>
                    <div class="ai-templates">
                        <button v-for="tpl in templates" :key="tpl.slug" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="startFromTemplate(tpl)">
                            {{ tpl.name }}
                        </button>
                    </div>
                </div>

                <div v-else class="ai-grid">
                    <article v-for="agent in agents" :key="agent._id" class="ah-card ai-agent" :class="{ 'ai-agent--paused': agent.paused }">
                        <div class="ai-agent__top">
                            <span class="ah-avatar ah-avatar--agent ah-avatar--lg"><ShellIcon name="agent" :size="16" /></span>
                            <div class="ai-agent__id">
                                <div class="ai-agent__name">
                                    <strong>{{ agent.name }}</strong>
                                    <span class="ah-chip ah-chip--agent ah-chip--mono">{{ autonomyChip(agent) }}</span>
                                    <span v-if="agent.paused" class="ah-chip ah-chip--warn">{{ $t('Ai.paused') }}</span>
                                </div>
                                <div class="ai-agent__scope">{{ scopeOf(agent) }}</div>
                            </div>
                        </div>

                        <div class="ai-agent__skills">
                            <span v-for="skill in agent.skills || []" :key="skill.key || skill" class="ah-chip">{{ skill.name || skill.key || skill }}</span>
                        </div>

                        <p class="ai-agent__today">{{ todayLine(agent) }}</p>

                        <div class="ai-agent__foot">
                            <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AiAgent', params: { cid: companyId, id: agent._id } }">{{ $t('Ai.open') }}</router-link>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="agent.paused || busyId === agent._id" @click="onRunNow(agent)">{{ $t('Ai.run_now') }}</button>
                            <button v-if="activeRuns[agent._id]" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busyId === agent._id" @click="onStop(agent)">{{ $t('Ai.stop') }}</button>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="setPaused(agent._id, !agent.paused)">
                                {{ agent.paused ? $t('Ai.resume') : $t('Ai.pause') }}
                            </button>
                            <span class="ai-agent__trigger">{{ triggerOf(agent) }}</span>
                        </div>
                    </article>
                </div>

                <section class="ah-card ai-agent ai-ladder">
                    <div class="ah-label">{{ $t('Ai.ladder') }}</div>
                    <div class="ai-ladder__steps" style="margin-top:8px">
                        <template v-for="(step, i) in AUTONOMY" :key="step.level">
                            <span class="ah-chip ah-chip--mono">{{ step.key }} · {{ ladderLabel(step) }}</span>
                            <ShellIcon v-if="i < AUTONOMY.length - 1" name="chevron" :size="12" class="ai-ladder__arrow" />
                        </template>
                    </div>
                    <p class="ai-ladder__rule">{{ $t('Ai.ladder_rule') }}</p>
                    <p class="ai-ladder__rule"><strong>{{ $t('Ai.never_label') }}</strong> <span class="ah-mono">{{ neverList }}</span></p>
                </section>
            </div>
        </div>

        <AgentWizard v-if="creating" :template="wizardTemplate" @close="creating = false; wizardTemplate = null" @created="onCreated" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiSidebar from "./AiSidebar.vue";
import AgentWizard from "./AgentWizard.vue";
import { useAgents, autonomyOf } from "./useAgents";
import { AGENT_TEMPLATES } from "./agentTemplates";

defineOptions({ name: "AiHubPage" });

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const { agents, spend, registryManifest, loading, lastError, AUTONOMY, loadAll, setPaused, runNow, activeRuns, loadActiveRuns, stopActive } = useAgents();

const creating = ref(false);
const wizardTemplate = ref(null);
const busyId = ref("");
const onStop = async (agent) => {
    busyId.value = agent._id;
    try { await stopActive(agent._id); } finally { busyId.value = ""; }
};

const templates = AGENT_TEMPLATES;

const neverList = computed(() => (registryManifest.value.never || []).join(" · "));

const autonomyChip = (agent) => {
    const a = autonomyOf(agent.autonomy);
    return `${a.key} · ${t(`Ai.autonomy_${a.level}`).toUpperCase()}`;
};
const ladderLabel = (step) => t(`Ai.autonomy_${step.level}`);

const scopeOf = (agent) => {
    const ids = agent.projectIds || [];
    return ids.length ? t("Ai.scope_projects", { n: ids.length }) : t("Ai.scope_all");
};

const triggerOf = (agent) => {
    const s = agent.schedule || {};
    if (s.cron) return s.cron;
    if (s.at) return t("Ai.every_day_at", { at: s.at });
    if (s.on) return s.on;
    return t("Ai.manual_only");
};

const todayLine = (agent) => {
    const row = (spend.value.agents || []).find((a) => a.agentId === String(agent._id));
    if (!row || !row.runs) return t("Ai.no_runs_today");
    return t("Ai.today_runs", { runs: row.runs, usd: Number(row.usd || 0).toFixed(2) });
};

const startFromTemplate = (tpl) => {
    wizardTemplate.value = tpl;
    creating.value = true;
};

const onCreated = () => {
    creating.value = false;
    wizardTemplate.value = null;
    loadAll();
    loadActiveRuns();
};

const onRunNow = async (agent) => {
    busyId.value = agent._id;
    try {
        await runNow(agent._id);
        $toast.success(t("Ai.run_started", { name: agent.name }), { position: "top-right" });
    } catch (error) {
        $toast.error(error.message, { position: "top-right" });
    } finally {
        busyId.value = "";
    }
};

onMounted(loadAll);
</script>

<style>
@import "./style.css";
</style>
