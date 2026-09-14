<template>
    <div class="ah-page parity-page">
        <AiSidebar />
        <div class="parity-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('AiLanding.title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <div class="ah-tabs">
                    <button type="button" class="ah-tab" :class="{ 'is-active': tab === 'ask' }" @click="tab = 'ask'">{{ $t('AiLanding.tab_ask') }}</button>
                    <button type="button" class="ah-tab" :class="{ 'is-active': tab === 'agents' }" @click="tab = 'agents'">{{ $t('AiLanding.tab_agents') }}</button>
                </div>
            </div>

            <div class="parity-page__body ah-scroll land" @click="closePops">
                <div class="land__col">
                    <div class="land__hero">
                        <span class="land__glyph"><ShellIcon name="ai" :size="20" /></span>
                        <h1 class="land__title">{{ $t('AiLanding.headline') }}</h1>
                        <p class="land__sub">{{ $t('AiLanding.sub') }}</p>
                    </div>

                    <template v-if="tab === 'ask'">
                        <div class="land__composer" :class="{ 'land__composer--off': !modelReady }">
                            <label class="ah-sr-only" for="land-q">{{ $t('AiLanding.question_label') }}</label>
                            <textarea
                                id="land-q"
                                v-model="question"
                                class="land__input"
                                :placeholder="$t('AiLanding.placeholder')"
                                @keydown.enter.exact.prevent="submit"
                            ></textarea>

                            <div class="land__controls" @click.stop>
                                <span class="land__ctl land__ctl--select">
                                    <ShellIcon name="projects" :size="13" />
                                    <select v-model="projectId" :aria-label="$t('AiLanding.ctl_scope_label')">
                                        <option value="">{{ $t('AiLanding.ctl_scope_all') }}</option>
                                        <option v-for="project in sources.projects || []" :key="project.id" :value="project.id">{{ project.name }}</option>
                                    </select>
                                </span>

                                <button type="button" class="land__ctl" :class="{ 'is-on': mode === 'research' }" :title="$t('AiLanding.ctl_depth_hint')" @click="mode = mode === 'research' ? 'ask' : 'research'">
                                    <ShellIcon name="reports" :size="13" />{{ $t('AiLanding.ctl_depth') }}
                                </button>

                                <span class="land__pop-wrap">
                                    <button type="button" class="land__ctl" :class="{ 'is-on': pop === 'skills' }" @click="toggle('skills')">
                                        <ShellIcon name="docs" :size="13" />{{ $t('AiLanding.ctl_skills') }}
                                    </button>
                                    <div v-if="pop === 'skills'" class="land__pop">
                                        <span class="ah-label">{{ $t('AiLanding.skills_title') }}</span>
                                        <p v-if="!reach.length" class="land__pop-note">{{ $t('AiLanding.skills_none') }}</p>
                                        <div v-for="skill in reach" :key="skill.key" class="land__pop-row">
                                            <span>
                                                <strong>{{ skill.name }}</strong><br />
                                                <span>{{ skill.requires ? $t('AiLanding.skill_needs', { need: $t(`Ai.req_${skill.requires.code}`) }) : $t('AiLanding.skill_needs_nothing') }}</span>
                                            </span>
                                            <span class="land__pop-reach ah-mono" :class="{ 'land__pop-reach--none': skill.matches === 0 }">{{ reachLabel(skill) }}</span>
                                        </div>
                                        <p class="land__pop-note">{{ $t('AiLanding.skills_note') }}</p>
                                    </div>
                                </span>

                                <span class="land__pop-wrap">
                                    <button type="button" class="land__ctl" :class="{ 'is-on': pop === 'models', 'land__ctl--warn': !modelReady }" @click="toggle('models')">
                                        <ShellIcon name="ai" :size="13" />{{ modelChip }}
                                    </button>
                                    <div v-if="pop === 'models'" class="land__pop">
                                        <span class="ah-label">{{ $t('AiLanding.models_title') }}</span>
                                        <p v-if="!models.length" class="land__pop-note">{{ $t('AiLanding.models_none') }}</p>
                                        <div v-for="model in models" :key="model.model" class="land__pop-row">
                                            <span>
                                                <strong>{{ model.model }}</strong><br />
                                                <span>{{ model.priced ? $t('AiLanding.model_priced', { usdIn: model.inputUsdPerMillion, usdOut: model.outputUsdPerMillion }) : $t('AiLanding.model_unpriced') }}</span>
                                            </span>
                                            <span class="land__pop-reach ah-mono">{{ model.tier }}</span>
                                        </div>
                                        <p class="land__pop-note">{{ $t('AiLanding.models_note') }}</p>
                                        <router-link v-if="canManage" class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'RoutingPolicy', params: { cid: companyId } }">{{ $t('AiLanding.models_open_policy') }}</router-link>
                                    </div>
                                </span>

                                <button type="button" class="land__ctl" :disabled="listening || transcribing" @click="dictate">
                                    <ShellIcon name="mic" :size="13" />{{ transcribing ? $t('AiLanding.transcribing') : $t('AiLanding.ctl_voice') }}
                                </button>

                                <span class="land__spacer"></span>

                                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!question.trim() || busy || !modelReady" @click="submit">
                                    {{ busy ? $t('AiLanding.sending') : (mode === 'research' ? $t('AiLanding.send_research') : $t('AiLanding.send')) }}
                                </button>
                            </div>

                            <MainChatRecorder ref="recorder" @recorded="onRecorded" @active="listening = $event" />
                        </div>

                        <p class="land__note">
                            <span>{{ sources.note || $t('Parity.scope_note') }}</span>
                            <span v-if="!modelReady" class="ah-chip ah-chip--warn ah-chip--sm">{{ $t('AiLanding.no_model_note') }}</span>
                        </p>
                        <p v-if="error" class="ah-field__error">{{ error }}</p>

                        <section v-if="answer.answer" class="ah-card">
                            <div class="ah-card__head">
                                <span class="ah-h3">{{ answer.mode === 'research' ? $t('Parity.report') : $t('Parity.answer') }}</span>
                                <span v-if="answer.usage" class="parity-count">{{ answer.usage.model }}</span>
                            </div>
                            <div class="ah-card__body">
                                <div class="ask__answer">{{ answer.answer }}</div>
                                <div v-if="(answer.cited || []).length" class="ask__cites">
                                    <div class="ah-label">{{ $t('Parity.cited') }}</div>
                                    <div v-for="source in answer.cited" :key="source.id" class="ask__cite">
                                        <span class="ask__cite-ref">{{ source.ref }}</span>
                                        <span>{{ source.title }}<span v-if="source.project" class="ah-muted"> · {{ source.project }}</span></span>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <p v-else-if="answer.empty" class="ah-empty">{{ answer.empty }}</p>

                        <div v-if="loading" class="ah-empty">{{ $t('Parity.loading') }}</div>

                        <template v-else-if="read.total">
                            <div class="land__read">
                                <p class="land__read-line">{{ readLine }}</p>
                                <p class="land__read-sub">{{ $t('AiLanding.read_sub') }}</p>
                            </div>

                            <div class="land__cards">
                                <button
                                    v-for="group in read.groups"
                                    :key="group.labelKey"
                                    type="button"
                                    class="land__card"
                                    :class="{ 'is-open': openKey === group.labelKey }"
                                    @click="openGroup(group)"
                                >
                                    <span class="land__card-n">{{ group.tasks.length }}</span>
                                    <strong>{{ $t(`AiLanding.kind_${group.labelKey}`) }}</strong>
                                    <span>{{ $t(`Parity.work_${group.labelKey}`) }}</span>
                                </button>

                                <button
                                    v-if="read.needsPerson"
                                    type="button"
                                    class="land__card land__card--people"
                                    :class="{ 'is-open': openKey === 'people' }"
                                    @click="openPeople()"
                                >
                                    <span class="land__card-n">{{ read.needsPerson }}</span>
                                    <strong>{{ $t('AiLanding.kind_person') }}</strong>
                                    <span>{{ $t(`Parity.why_${read.whyKeys[0]}`) }}</span>
                                </button>
                            </div>

                            <section v-if="openKey === 'people'" class="ah-card">
                                <div class="ah-card__head">
                                    <span class="ah-h3">{{ $t('AiLanding.people_title') }}</span>
                                    <span class="parity-count">{{ $t('AiLanding.n_tasks', { n: read.needsPerson }) }}</span>
                                </div>
                                <div class="ah-card__body">
                                    <div v-for="entry in read.people.slice(0, PANEL_LIMIT)" :key="entry.task._id" class="land__row">
                                        <span class="land__row-key ah-mono">{{ entry.task.TaskKey || '—' }}</span>
                                        <span class="land__row-title">{{ entry.task.TaskName }}</span>
                                        <span class="land__row-to">{{ $t(`Parity.work_${entry.work.labelKey}`) }}</span>
                                    </div>
                                    <p class="land__trust-note">{{ $t('AiLanding.people_note') }}</p>
                                </div>
                            </section>

                            <section v-else-if="openGroupRef" class="land__panel">
                                <div class="land__panel-head">
                                    <span class="ah-h3">{{ $t('AiLanding.panel_title', { kind: $t(`AiLanding.kind_${openGroupRef.labelKey}`) }) }}</span>
                                    <span class="ah-toolbar__spacer"></span>
                                    <span class="parity-count">{{ $t('AiLanding.panel_showing', { n: panelTasks.length, total: openGroupRef.tasks.length }) }}</span>
                                </div>
                                <div class="land__panel-body">
                                    <div class="land__rows">
                                        <div v-for="row in rows" :key="row.taskId" class="land__row" :class="{ 'land__row--refused': !row.routed }">
                                            <span class="land__row-title">{{ row.title }}</span>
                                            <span class="land__row-to">
                                                <template v-if="row.routed">
                                                    <span class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="11" /></span>
                                                    <strong>{{ row.agent.name }}</strong>
                                                </template>
                                                <strong v-else>{{ refusalText(t, row) }}</strong>
                                            </span>
                                        </div>
                                    </div>

                                    <div class="land__trust">
                                        <span class="ah-label">{{ $t('AiLanding.before_start') }}</span>
                                        <dl>
                                            <div><dt>{{ $t('AiLanding.will_touch') }}</dt><dd>{{ willTouch }}</dd></div>
                                            <div><dt>{{ $t('AiLanding.wont_touch') }}</dt><dd>{{ wontTouch }}</dd></div>
                                            <div><dt>{{ $t('AiLanding.est_cost') }}</dt><dd>{{ costLine }}</dd></div>
                                            <div><dt>{{ $t('AiLanding.for_people') }}</dt><dd>{{ $t('AiLanding.n_tasks', { n: totals.forPeople }) }}</dd></div>
                                        </dl>
                                        <p class="land__trust-note">{{ $t('AiLanding.approval_note') }}</p>
                                    </div>

                                    <p v-if="startError" class="ah-field__error">{{ startError }}</p>

                                    <div class="land__actions">
                                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!totals.routed || starting" @click="startAll">
                                            {{ starting ? $t('Parity.starting') : $t('AiLanding.start_n', { n: totals.routed }) }}
                                        </button>
                                        <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AgentRouting', params: { cid: companyId } }">{{ $t('AiLanding.open_router') }}</router-link>
                                        <span class="land__cost">{{ $t('AiLanding.revert_note') }}</span>
                                    </div>
                                </div>
                            </section>
                        </template>

                        <div v-else class="land__sell">
                            <h3>{{ $t('AiLanding.no_backlog_title') }}</h3>
                            <p>{{ $t('AiLanding.no_backlog_body') }}</p>
                            <router-link class="ah-btn ah-btn--primary ah-btn--sm" :to="{ name: 'Projects', params: { cid: companyId } }">{{ $t('AiLanding.no_backlog_action') }}</router-link>
                        </div>
                    </template>

                    <template v-else>
                        <div v-if="loading" class="ah-empty">{{ $t('Parity.loading') }}</div>

                        <div v-else-if="!agents.length" class="land__sell">
                            <h3>{{ $t('AiLanding.no_agents_title') }}</h3>
                            <p>{{ $t('AiLanding.no_agents_body') }}</p>
                            <router-link v-if="canManage" class="ah-btn ah-btn--primary ah-btn--sm" :to="{ name: 'AiHub', params: { cid: companyId } }">{{ $t('AiLanding.no_agents_action') }}</router-link>
                            <p v-else class="land__sell-promise">{{ $t('AiLanding.no_agents_member') }}</p>
                            <span v-if="canManage" class="land__sell-promise">{{ $t('AiLanding.no_agents_promise') }}</span>
                        </div>

                        <template v-else>
                            <div class="land__agents">
                                <article v-for="agent in agents" :key="agent._id" class="land__agent">
                                    <div class="land__agent-top">
                                        <span class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="11" /></span>
                                        <strong>{{ agent.name }}</strong>
                                        <span class="ah-chip ah-chip--agent ah-chip--mono ah-chip--sm">{{ autonomyOf(agent.autonomy).key }}</span>
                                        <span v-if="agent.paused" class="ah-chip ah-chip--warn ah-chip--sm">{{ $t('Ai.paused') }}</span>
                                    </div>
                                    <div class="land__agent-skills">
                                        <span v-for="skill in agent.skills || []" :key="skill.key || skill" class="ah-chip ah-chip--sm">{{ skill.name || skill.key || skill }}</span>
                                    </div>
                                    <p class="land__agent-line">{{ writesLine(agent) }}</p>
                                    <p class="land__agent-line">{{ spendLine(agent) }}</p>
                                </article>
                            </div>
                            <div class="land__actions">
                                <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AiHub', params: { cid: companyId } }">{{ $t('AiLanding.manage_agents') }}</router-link>
                                <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AiInbox', params: { cid: companyId } }">{{ $t('AiLanding.open_inbox') }}</router-link>
                                <span class="land__cost">{{ $t('AiLanding.agents_note') }}</span>
                            </div>
                        </template>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import MainChatRecorder from "@/components/organisms/MainChat/MainChatRecorder.vue";
import AiSidebar from "./AiSidebar.vue";
import { useParity } from "./useParity";
import { useAgents, reasonOf, autonomyOf } from "./useAgents";
import { useAgentAccess } from "./agentAccess";
import { routeTasks, routingTotals } from "./agentFit";
import { refusalText } from "./fitText";
import { backlogRead, skillReach } from "./backlogRead";

// The AI landing (13i, re-framed). Ask stays the way in, and beneath it the open
// backlog is read back through the same classifier the router uses — a scoped
// query and a regex, no model call — so a workspace with no run history still
// opens on real work rather than on zeros.
defineOptions({ name: "AskPage" });

const PANEL_LIMIT = 8;

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const { agents, registryManifest, runs, routable, loadAgents, loadRegistry, loadRuns, loadRoutable, startRun } = useParity();
const { spend, skillManifest, loadSkills, loadSpend } = useAgents();
const { canManage } = useAgentAccess();

const tab = ref("ask");
const question = ref("");
const mode = ref("ask");
const projectId = ref("");
const busy = ref(false);
const error = ref("");
const answer = ref({});
const sources = ref({});
const models = ref([]);
const loading = ref(true);
const pop = ref("");
const openKey = ref("");
const starting = ref(false);
const startError = ref("");
const listening = ref(false);
const transcribing = ref(false);
const recorder = ref(null);

const read = computed(() => backlogRead(routable.value));
const reach = computed(() => skillReach(skillManifest.value, routable.value));

const modelReady = computed(() => sources.value.configured !== false && models.value.some((m) => m.priced));

const modelChip = computed(() => {
    if (sources.value.configured === false) return t("AiLanding.no_model_chip");
    if (!modelReady.value) return t("AiLanding.unpriced_chip");
    return t("AiLanding.ctl_model");
});

const readLine = computed(() => {
    const parts = read.value.groups.map((g) => t("AiLanding.read_part", { n: g.tasks.length, work: t(`AiLanding.kind_${g.labelKey}`) }));
    if (read.value.needsPerson) parts.push(t("AiLanding.read_part", { n: read.value.needsPerson, work: t("AiLanding.kind_person") }));
    return t("AiLanding.read_line", { n: read.value.total, parts: parts.join(t("AiLanding.read_join")) });
});

const openGroupRef = computed(() => read.value.groups.find((g) => g.labelKey === openKey.value) || null);
const panelTasks = computed(() => (openGroupRef.value ? openGroupRef.value.tasks.slice(0, PANEL_LIMIT) : []));

const rows = computed(() => routeTasks({
    tasks: panelTasks.value,
    agents: agents.value,
    runs: runs.value,
    registryActions: registryManifest.value.actions || [],
    never: registryManifest.value.never || []
}));

const totals = computed(() => routingTotals(rows.value));

const routedAgents = computed(() => rows.value.filter((r) => r.routed).map((r) => r.agent));

const listOf = (pick) => {
    const all = [...new Set(routedAgents.value.flatMap(pick))];
    return all.length ? all.slice(0, 4).join(", ") : t("AiLanding.nothing_listed");
};
const willTouch = computed(() => listOf((a) => a.will));
const wontTouch = computed(() => listOf((a) => a.wont));

const costLine = computed(() => (totals.value.priced
    ? t("Parity.about_usd", { usd: totals.value.usd.toFixed(2) })
    : t("Parity.cost_unknown")));

const reachLabel = (skill) => {
    if (skill.scope === "project") return t("AiLanding.skill_scope_project");
    if (!skill.matches) return t("AiLanding.skill_reach_none");
    return t("AiLanding.skill_reach", { n: skill.matches, total: read.value.total });
};

const writesLine = (agent) => {
    const writes = (registryManifest.value.actions || []).filter((a) => a.write);
    const allowed = Array.isArray(agent.allowedActions) && agent.allowedActions.length ? agent.allowedActions : null;
    const will = writes.filter((a) => !allowed || allowed.includes(a.key)).map((a) => a.label);
    return will.length ? t("AiLanding.agent_will", { what: will.slice(0, 3).join(", ") }) : t("AiLanding.agent_reads_only");
};

const spendLine = (agent) => {
    const row = (spend.value.agents || []).find((a) => a.agentId === String(agent._id));
    return row && row.runs ? t("Ai.month_runs", { runs: row.runs, usd: Number(row.usd || 0).toFixed(2) }) : t("Ai.no_runs_month");
};

const toggle = (which) => { pop.value = pop.value === which ? "" : which; };
const closePops = () => { pop.value = ""; };

const openGroup = (group) => { openKey.value = openKey.value === group.labelKey ? "" : group.labelKey; startError.value = ""; };
const openPeople = () => { openKey.value = openKey.value === "people" ? "" : "people"; };

const submit = async () => {
    if (!question.value.trim() || !modelReady.value) return;
    busy.value = true;
    error.value = "";
    try {
        const body = { question: question.value.trim(), mode: mode.value };
        if (projectId.value) body.projectId = projectId.value;
        const res = await apiRequest("post", env.AI_ASK, body);
        if (!res?.data?.status) { error.value = res?.data?.statusText || t("Parity.ask_failed"); return; }
        answer.value = res.data.data || {};
    } catch (e) {
        error.value = reasonOf(e, "Parity.ask_failed");
    } finally {
        busy.value = false;
    }
};

const startAll = async () => {
    starting.value = true;
    startError.value = "";
    let done = 0;
    try {
        for (const row of rows.value.filter((r) => r.routed)) {
            // Sequential on purpose: every run is a spend decision, and a refusal
            // half way through must leave the rest unstarted rather than racing.
            // eslint-disable-next-line no-await-in-loop
            await startRun({ agentId: row.agent.agentId, taskId: row.taskId, trigger: "assignment", note: row.agent.reason });
            done += 1;
        }
        $toast.success(t("AiLanding.started_n", { n: done }), { position: "top-right" });
        openKey.value = "";
    } catch (e) {
        startError.value = t("AiLanding.started_partial", { n: done, error: e.message });
    } finally {
        starting.value = false;
    }
};

const dictate = () => recorder.value && recorder.value.start();

const onRecorded = async (file) => {
    transcribing.value = true;
    error.value = "";
    try {
        const form = new FormData();
        form.append("file", file);
        const res = await apiRequest("post", env.AI_TRANSCRIBE, form, "form");
        const text = res?.data?.status && typeof res.data.data?.text === "string" ? res.data.data.text.trim() : "";
        if (!text) { error.value = res?.data?.statusText || t("AiLanding.transcribe_failed"); return; }
        question.value = question.value ? `${question.value} ${text}` : text;
    } catch (e) {
        error.value = reasonOf(e, "AiLanding.transcribe_failed");
    } finally {
        transcribing.value = false;
    }
};

onMounted(async () => {
    const [sourceRes, modelRes] = await Promise.all([
        apiRequest("get", env.AI_ASK_SOURCES).catch(() => null),
        apiRequest("get", `${env.AGENT_MODELS}?configured=true`).catch(() => null)
    ]);
    if (sourceRes?.data?.status) sources.value = sourceRes.data.data || {};
    if (modelRes?.data?.status) models.value = modelRes.data.data?.models || [];
    try {
        await Promise.all([loadRoutable(), loadAgents(), loadRegistry(), loadRuns(), loadSkills(), loadSpend()]);
    } catch (e) {
        error.value = reasonOf(e, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
});
</script>

<style>
@import "./parity.css";
@import "./landing.css";
</style>
