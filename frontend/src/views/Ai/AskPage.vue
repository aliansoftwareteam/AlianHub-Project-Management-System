<template>
    <div class="ah-page parity-page">
        <AiSidebar />
        <div class="parity-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('AiLanding.title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <AskMemoryButton />
            </div>

            <AiModelNotice />
            <div class="parity-page__body ah-scroll land" @click="closePops">
                <div class="land__col">
                    <div class="land__hero">
                        <span class="land__glyph"><ShellIcon name="ai" :size="20" /></span>
                        <h1 class="land__title">{{ $t('AiLanding.headline') }}</h1>
                        <p class="land__sub">{{ $t('AiLanding.sub') }}</p>
                        <div class="ah-tabs">
                            <button type="button" class="ah-tab" :class="{ 'is-active': tab === 'ask' }" @click="tab = 'ask'">{{ $t('AiLanding.tab_ask') }}</button>
                            <button type="button" class="ah-tab" :class="{ 'is-active': tab === 'agents' }" @click="tab = 'agents'">{{ $t('AiLanding.tab_agents') }}</button>
                        </div>
                    </div>

                    <template v-if="tab === 'ask'">
                        <p class="ah-sr-only" aria-live="polite" data-test="ask-live">{{ announcement }}</p>

                        <div class="ask-bar">
                            <button
                                type="button"
                                class="ah-btn ah-btn--ghost ah-btn--sm"
                                aria-controls="ask-history"
                                :aria-expanded="historyOpen ? 'true' : 'false'"
                                data-test="ask-history-toggle"
                                @click="historyOpen = !historyOpen"
                            >
                                <ShellIcon name="clock" :size="13" />{{ $t('Ask.history_title') }}
                                <span class="parity-count">{{ threads.length }}</span>
                            </button>
                            <span class="ah-toolbar__spacer"></span>
                            <button v-if="turns.length" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="ask-new" @click="startOver">
                                <ShellIcon name="plus" :size="13" />{{ $t('Ask.new_question') }}
                            </button>
                        </div>

                        <section v-if="historyOpen" id="ask-history" class="ah-card ask-history" :aria-label="$t('Ask.history_title')">
                            <div class="ah-card__body">
                                <p v-if="threadsLoading && !threads.length" class="ah-small">{{ $t('Parity.loading') }}</p>
                                <p v-else-if="!threads.length" class="ah-small">{{ $t('Ask.history_empty') }}</p>
                                <ul v-else class="ask-history__list">
                                    <li v-for="item in threads" :key="item.id" class="ask-history__row" :class="{ 'is-active': item.id === threadId }">
                                        <button
                                            type="button"
                                            class="ask-history__open"
                                            :aria-current="item.id === threadId ? 'true' : undefined"
                                            data-test="ask-history-open"
                                            @click="openFromHistory(item.id)"
                                        >
                                            <span class="ask-history__title">{{ item.title || $t('Ask.history_untitled') }}</span>
                                            <span class="ah-small">{{ $t('Ask.thread_turns', { n: item.turns }, Number(item.turns) || 0) }}</span>
                                        </button>
                                        <button
                                            type="button"
                                            class="ah-btn ah-btn--ghost ah-btn--sm"
                                            :aria-label="$t('Ask.thread_delete', { title: item.title || $t('Ask.history_untitled') })"
                                            data-test="ask-history-delete"
                                            @click="deleteFromHistory(item)"
                                        >
                                            <ShellIcon name="trash" :size="13" />
                                        </button>
                                    </li>
                                </ul>
                                <p class="ah-small ask-history__note">{{ $t('Ask.history_note', { threads: THREAD_LIMIT, turns: TURN_LIMIT }) }}</p>
                            </div>
                        </section>
                        <p v-if="threadError" class="ah-field__error">{{ threadError }}</p>

                        <ol v-if="turns.length" class="ask-thread" :aria-label="$t('Ask.conversation_label')">
                            <li v-for="turn in turns" :key="turn.key" class="ask-thread__turn" data-test="ask-turn">
                                <p class="ask-thread__q"><span class="ah-sr-only">{{ $t('Ask.you_asked') }}</span>{{ turn.question }}</p>
                                <AskAnswer v-if="showsAnswer(turn)" :answer="turn" :streaming="turn.status === 'streaming'" />
                                <p v-if="turn.status === 'stopped'" class="ah-small" data-test="ask-stopped">{{ $t('Ask.stopped') }}</p>
                                <p v-else-if="turn.status === 'error'" class="ah-field__error" data-test="ask-turn-error">{{ turn.error }}</p>
                                <p v-else-if="turn.status === 'empty' || turn.status === 'unconfigured'" class="ah-empty">{{ turn.error }}</p>
                            </li>
                        </ol>

                        <div class="land__composer" :class="{ 'land__composer--off': !providerReady }">
                            <label class="ah-sr-only" for="land-q">{{ $t('AiLanding.question_label') }}</label>
                            <textarea
                                id="land-q"
                                ref="questionBox"
                                v-model="question"
                                class="land__input"
                                :placeholder="turns.length ? $t('Ask.follow_up_placeholder') : $t('AiLanding.placeholder')"
                                @keydown.enter.exact="onEnter"
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

                                <button v-if="streaming" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="ask-stop" @click="stopAnswer">
                                    <ShellIcon name="stop" :size="13" />{{ $t('Ask.stop') }}
                                </button>
                                <button v-else type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="ask-send" :disabled="!question.trim()" @click="submit">
                                    {{ mode === 'research' ? $t('AiLanding.send_research') : $t('AiLanding.send') }}
                                </button>
                            </div>

                            <MainChatRecorder ref="recorder" @recorded="onRecorded" @active="listening = $event" />
                        </div>

                        <p class="land__note">
                            <span>{{ coded(sources.noteCode, sources.note) || $t('Ask.note_scope') }}</span>
                            <span v-if="!providerReady" class="ah-chip ah-chip--warn ah-chip--sm">{{ $t('AiLanding.no_model_note') }}</span>
                        </p>
                        <p v-if="error" class="ah-field__error">{{ error }}</p>

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
                                    <span>{{ peopleWhy }}</span>
                                </button>
                            </div>

                            <p v-if="read.unshaped" class="land__rest">{{ restLine }}</p>

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
                                            <input v-if="row.routed" class="ah-check" type="checkbox" :checked="accepted.includes(row.taskId)" @change="acceptToggle(row)" />
                                            <span v-else class="ah-dot ah-dot--warn"></span>
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
                                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!chosen.length || starting" @click="startAll">
                                            {{ starting ? $t('Parity.starting') : $t('AiLanding.start_n', { n: chosen.length }) }}
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
import AiModelNotice from '@/components/molecules/AiUnavailable/AiModelNotice.vue';
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import MainChatRecorder from "@/components/organisms/MainChat/MainChatRecorder.vue";
import AiSidebar from "./AiSidebar.vue";
import AskAnswer from "./AskAnswer.vue";
import AskMemoryButton from "./AskMemoryButton.vue";
import { useParity } from "./useParity";
import { useAgents, reasonOf, autonomyOf } from "./useAgents";
import { useAgentAccess } from "./agentAccess";
import { routeTasks, routingTotals } from "./agentFit";
import { refusalText } from "./fitText";
import { backlogRead, readLineKey, skillReach } from "./backlogRead";
import { messageKey } from "./askWhy";
import { takeAskHandoff } from "@/components/molecules/AdvanceSearch/askHandoff";
import { useAskConversation } from "./useAskConversation";

defineOptions({ name: "AskPage" });

const PANEL_LIMIT = 8;
/* The server caps /routable at 100, so a full page is a window on the backlog
 * rather than the whole of it, and the headline has to say which it is. */
const BACKLOG_LIMIT = 100;
/* The server's Ask thread limits (Modules/AI/askThreads LIMITS), stated beside the history. */
const THREAD_LIMIT = 50;
const TURN_LIMIT = 30;

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const { agents, registryManifest, runs, routable, loadAgents, loadRegistry, loadRuns, loadRoutable, startRun } = useParity();
const { spend, skillManifest, loadSkills, loadSpend } = useAgents();
const { canManage } = useAgentAccess();
const { turns, threadId, threads, threadsLoading, streaming, announcement, send, stop, newQuestion, loadThreads, openThread, removeThread, seed } = useAskConversation({ t });

const route = useRoute();
const tab = ref("ask");
const question = ref(typeof route?.query?.q === "string" ? route.query.q : "");
const mode = ref("ask");
const projectId = ref("");
const error = ref("");
const questionBox = ref(null);
const historyOpen = ref(false);
const threadError = ref("");
const handedOff = takeAskHandoff(question.value);
if (handedOff) {
    seed(question.value, handedOff);
    question.value = "";
}
const sources = ref({});
const models = ref([]);
const loading = ref(true);
const pop = ref("");
const openKey = ref("");
const accepted = ref([]);
const starting = ref(false);
const startError = ref("");
const listening = ref(false);
const transcribing = ref(false);
const recorder = ref(null);

const read = computed(() => backlogRead(routable.value));
const reach = computed(() => skillReach(skillManifest.value, routable.value));

const providerReady = computed(() => sources.value.configured !== false);
/* A model the pricing table does not cover is refused by name when an agent run starts
 * (Agents/runs canStart), so the model chip warns. Asking still sends: the server says
 * whether it will answer, and a missing price never hides the screen. */
const unpriced = computed(() => providerReady.value && models.value.length > 0 && !models.value.some((m) => m.priced));
const modelReady = computed(() => providerReady.value && !unpriced.value);

const modelChip = computed(() => {
    if (!providerReady.value) return t("AiLanding.no_model_chip");
    if (unpriced.value) return t("AiLanding.unpriced_chip");
    return t("AiLanding.ctl_model");
});

const capped = computed(() => read.value.total >= BACKLOG_LIMIT);

const readLine = computed(() => {
    const parts = read.value.groups.map((g) => t("AiLanding.read_part", { n: g.tasks.length, work: t(`AiLanding.kind_${g.labelKey}`) }));
    if (read.value.needsPerson) parts.push(t("AiLanding.read_part", { n: read.value.needsPerson, work: t("AiLanding.kind_person") }));
    return t(readLineKey({ capped: capped.value, hasParts: parts.length > 0 }), { n: read.value.total, parts: parts.join(t("AiLanding.read_join")) });
});

const restLine = computed(() => t("AiLanding.rest_line", { n: read.value.unshaped, work: t("AiLanding.kind_general") }));

const peopleWhy = computed(() => (read.value.whyKeys.length === 1
    ? t(`Parity.why_${read.value.whyKeys[0]}`)
    : t("AiLanding.why_mixed")));

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
const chosen = computed(() => rows.value.filter((r) => r.routed && accepted.value.includes(r.taskId)));
const chosenTotals = computed(() => routingTotals(chosen.value));

const routedAgents = computed(() => chosen.value.map((r) => r.agent));

const listOf = (pick) => {
    const all = [...new Set(routedAgents.value.flatMap(pick))];
    return all.length ? all.slice(0, 4).join(", ") : t("AiLanding.nothing_listed");
};
const willTouch = computed(() => listOf((a) => a.will));
const wontTouch = computed(() => listOf((a) => a.wont));

const costLine = computed(() => (chosenTotals.value.priced
    ? t("Parity.about_usd", { usd: chosenTotals.value.usd.toFixed(2) })
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
    return row && row.runs ? t("Ai.month_runs", { runs: row.runs, usd: Number(row.usd || 0).toFixed(2) }, Number(row.runs) || 0) : t("Ai.no_runs_month");
};

const coded = (code, sentence) => (messageKey(code) ? t(messageKey(code)) : sentence || "");

const toggle = (which) => { pop.value = pop.value === which ? "" : which; };
const closePops = () => { pop.value = ""; };

const openGroup = (group) => {
    openKey.value = openKey.value === group.labelKey ? "" : group.labelKey;
    startError.value = "";
    accepted.value = rows.value.filter((r) => r.routed).map((r) => r.taskId);
};
const openPeople = () => { openKey.value = openKey.value === "people" ? "" : "people"; };
const acceptToggle = (row) => {
    accepted.value = accepted.value.includes(row.taskId)
        ? accepted.value.filter((id) => id !== row.taskId)
        : accepted.value.concat(row.taskId);
};

const focusQuestion = () => nextTick(() => questionBox.value && questionBox.value.focus());

const showsAnswer = (turn) => turn.status === "streaming" || ((turn.status === "done" || turn.status === "stopped") && Boolean(turn.answer));

const submit = async () => {
    const asked = question.value.trim();
    if (!asked || streaming.value) return;
    error.value = "";
    question.value = "";
    await send({ question: asked, mode: mode.value, projectId: projectId.value });
};

const onEnter = (event) => {
    if (event.isComposing) return;
    event.preventDefault();
    submit();
};

const stopAnswer = () => {
    stop();
    focusQuestion();
};

const startOver = () => {
    newQuestion();
    threadError.value = "";
    question.value = "";
    focusQuestion();
};

const openFromHistory = async (id) => {
    threadError.value = await openThread(id);
    if (!threadError.value) focusQuestion();
};

const deleteFromHistory = async (item) => {
    if (!window.confirm(t("Ask.thread_delete_confirm"))) return;
    threadError.value = await removeThread(item.id);
    if (!threadError.value) $toast.success(t("Ask.thread_deleted"), { position: "top-right" });
};

const startAll = async () => {
    starting.value = true;
    startError.value = "";
    let done = 0;
    try {
        for (const row of chosen.value) {
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

onBeforeUnmount(stop);

onMounted(async () => {
    loadThreads();
    const [sourceRes, modelRes] = await Promise.all([
        apiRequest("get", env.AI_ASK_SOURCES).catch(() => null),
        apiRequest("get", `${env.AGENT_MODELS}?configured=true`).catch(() => null)
    ]);
    if (sourceRes?.data?.status) sources.value = sourceRes.data.data || {};
    if (modelRes?.data?.status) models.value = modelRes.data.data?.models || [];
    try {
        await Promise.all([loadRoutable("", { limit: BACKLOG_LIMIT }), loadAgents(), loadRegistry(), loadRuns(), loadSkills(), loadSpend()]);
    } catch (e) {
        error.value = reasonOf(e, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
});
</script>

<style>
@import "./style.css";
@import "./parity.css";
@import "./landing.css";

.ask-bar { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.ask-history__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.ask-history__row { display: flex; align-items: center; gap: var(--sp-2); border-radius: var(--r-input); }
.ask-history__row.is-active { background: var(--brand-tint); }
.ask-history__open { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: var(--sp-3); border: 0; border-radius: var(--r-input); background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.ask-history__open:hover { background: var(--surface-hover); }
.ask-history__title { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ask-history__note { margin-top: var(--sp-3); }
.ask-thread { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-7); }
.ask-thread__turn { display: flex; flex-direction: column; gap: var(--sp-3); }
.ask-thread__q { align-self: flex-end; max-width: 85%; margin: 0; padding: var(--sp-3) var(--sp-5); border-radius: var(--r-card); background: var(--brand-tint); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 480px) {
    .ask-thread__q { max-width: 100%; }
}
</style>
