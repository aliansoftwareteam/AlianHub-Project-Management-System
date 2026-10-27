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
                <button v-if="canManage" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="stop-agent" :disabled="busy" @click="stop">{{ $t('Ai.stop_agent') }}</button>
            </div>

            <div v-if="!loadingAgent" class="ai-tabbar">
                <div class="ah-tabs" role="tablist" :aria-label="$t('Ai.agent_tabs_label')" data-test="agent-tabs" @keydown="onTabKey">
                    <button
                        v-for="key in tabs"
                        :id="`agent-tab-${key}`"
                        :key="key"
                        type="button"
                        role="tab"
                        class="ah-tab ai-tabbar__tab"
                        :class="{ 'is-active': key === activeTab, 'ai-tabbar__tab--danger': key === 'delete' }"
                        :aria-selected="key === activeTab"
                        :aria-controls="`agent-panel-${key}`"
                        :tabindex="key === activeTab ? 0 : -1"
                        :data-tab="key"
                        @click="pick(key)"
                    >
                        {{ $t(`Ai.agent_tab_${key}`) }}
                        <span v-if="tabCount(key) !== null" class="ai-tabbar__count">{{ tabCount(key) }}</span>
                        <span v-if="dirtyTabs.has(key)" class="ai-tabbar__dot" :title="$t('Ai.unsaved_changes')" :data-test="`dirty-${key}`"></span>
                    </button>
                </div>
            </div>

            <div class="ai-page__body ah-scroll">
                <div v-if="loadingAgent" class="ah-empty">{{ $t('Ai.loading') }}</div>
                <div v-else class="ai-settings">
                    <p v-if="!canManage" class="ah-chip ah-chip--warn" data-test="read-only">{{ $t('Ai.settings_read_only') }}</p>

                    <div v-show="activeTab === 'skills'" id="agent-panel-skills" role="tabpanel" aria-labelledby="agent-tab-skills" class="ai-panel">
                        <section class="ah-card ai-agent">
                            <div class="ah-label">{{ $t('Ai.skills_actions') }}</div>
                            <p class="ai-lead ai-panel__lead">{{ $t('Ai.skills_lead') }}</p>

                            <p v-if="!usedSkillCount" class="ah-small" data-test="no-skills-on">{{ $t('Ai.skills_none_on') }}</p>
                            <template v-for="(skill, i) in orderedSkills" :key="skill.key">
                                <button
                                    v-if="i === usedSkillCount"
                                    type="button"
                                    class="ah-btn ah-btn--ghost ah-btn--sm ai-skills__more"
                                    :aria-expanded="showLibrary"
                                    data-test="skills-more"
                                    @click="showLibrary = !showLibrary"
                                >
                                    <span class="ai-skills__chev" :class="{ 'is-open': showLibrary }"><ShellIcon name="chevronDown" :size="13" /></span>
                                    {{ showLibrary ? $t('Ai.skills_library_hide') : t('Ai.skills_library_show', { n: orderedSkills.length - usedSkillCount }, orderedSkills.length - usedSkillCount) }}
                                </button>
                                <div v-show="i < usedSkillCount || showLibrary || skill.enabled" class="ai-skill">
                                    <div class="ai-skill__head">
                                        <input :id="`sk-${skill.key}`" v-model="skill.enabled" type="checkbox" class="ah-check" :disabled="!canManage" />
                                        <label :for="`sk-${skill.key}`" class="ai-skill__name" :title="skill.key">{{ skillLabel(t, skill) }}</label>
                                        <span v-if="skill.source === 'data'" class="ah-chip ah-chip--brand ah-chip--sm">{{ $t('Ai.skill_source_yours') }}</span>
                                        <span v-if="skill.model" class="ah-chip ah-chip--mono ah-chip--sm">{{ skill.model }}</span>
                                        <span v-if="!skill.enabled" class="ah-chip ah-chip--sm">{{ $t('Ai.off') }}</span>
                                        <span v-else-if="!skill.resolved" class="ah-chip ah-chip--danger ah-chip--sm">{{ $t('Ai.skill_unresolved') }}</span>
                                    </div>
                                    <div class="ai-skill__actions">
                                        <span v-for="a in effectiveOf(skill)" :key="a" class="ah-chip ah-chip--sm" :title="a">{{ nameOfAction(a) }}</span>
                                        <span v-for="a in outsideOf(skill)" :key="`x-${a}`" class="ah-chip ah-chip--sm ai-skill__outside" :title="a">{{ nameOfAction(a) }}</span>
                                    </div>
                                    <p v-if="skill.enabled" class="ah-small ai-skill__needs">
                                        {{ $t('Ai.skill_needs', { what: $t(`Ai.req_${skill.requires ? skill.requires.code : 'task'}`) }) }}
                                        <span v-if="outsideOf(skill).length">· {{ $t('Ai.skill_outside_agent', { list: outsideOf(skill).map(nameOfAction).join(', ') }) }}</span>
                                    </p>
                                </div>
                            </template>
                            <div class="ai-skills__foot">
                                <p class="ah-small">{{ $t('Ai.skills_effective_note') }}</p>
                                <router-link v-if="canManage" class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AiSkills', params: { cid: companyId } }">
                                    {{ $t('Ai.skills_open_library') }}
                                </router-link>
                            </div>

                            <p class="ai-never">
                                <strong>{{ $t('Ai.never_label') }}</strong>
                                <span>{{ never }}</span>
                                <span class="ah-small">{{ $t('Ai.never_note') }}</span>
                            </p>
                        </section>
                    </div>

                    <div v-show="activeTab === 'projects'" id="agent-panel-projects" role="tabpanel" aria-labelledby="agent-tab-projects" class="ai-panel">
                        <section v-if="roles.length" class="ah-card ai-agent" data-test="role">
                            <div class="ah-field">
                                <div class="ah-label">{{ $t('Ai.role') }}</div>
                                <span class="ah-small">{{ $t('Ai.role_lead') }}</span>
                                <label class="ah-field__label" for="agent-role">{{ $t('Ai.role') }}</label>
                                <select id="agent-role" v-model="form.role" class="ah-input" :disabled="!canManage" data-test="role-pick">
                                    <option value="">{{ $t('Ai.role_none') }}</option>
                                    <option v-for="role in roles" :key="role.id" :value="role.id">{{ $t('Ai.role_option', { name: role.name, department: role.department }) }}</option>
                                </select>
                                <span class="ah-field__hint">{{ $t('Ai.role_hint') }}</span>
                            </div>
                        </section>

                        <section class="ah-card ai-agent" data-test="scope">
                            <div class="ah-label">{{ $t('Ai.scope') }}</div>
                            <p class="ai-lead ai-panel__lead">{{ $t('Ai.scope_lead') }}</p>
                            <template v-if="projects.length">
                                <div class="ai-scope__tools">
                                    <input
                                        v-model="projectQuery"
                                        type="search"
                                        class="ah-input ai-scope__search"
                                        :placeholder="$t('Ai.scope_search', { n: projects.length })"
                                        :aria-label="$t('Ai.scope_search', { n: projects.length })"
                                        data-test="scope-search"
                                    />
                                    <span class="ah-small ai-scope__count" data-test="scope-count">{{ $t('Ai.scope_chosen_count', { n: form.projectIds.length, total: projects.length }) }}</span>
                                    <button type="button" class="ah-btn ah-btn--sm" :class="chosenOnly ? 'ah-btn--secondary is-on' : 'ah-btn--ghost'" :aria-pressed="chosenOnly" data-test="scope-chosen-only" @click="chosenOnly = !chosenOnly">{{ $t('Ai.scope_chosen_only') }}</button>
                                    <template v-if="canManage">
                                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="!shownProjects.length" data-test="scope-choose-shown" @click="chooseShown">{{ $t('Ai.scope_choose_shown') }}</button>
                                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="!form.projectIds.length" data-test="scope-clear" @click="form.projectIds = []">{{ $t('Ai.scope_clear') }}</button>
                                    </template>
                                </div>
                                <div v-if="shownProjects.length" class="ai-scope__grid" data-test="scope-grid">
                                    <label v-for="p in shownProjects" :key="p._id" class="ai-scope__item" :class="{ 'is-on': form.projectIds.includes(String(p._id)) }" :title="p.ProjectName">
                                        <input v-model="form.projectIds" type="checkbox" :value="String(p._id)" class="ah-check" :disabled="!canManage" />
                                        <span class="ai-scope__name">{{ p.ProjectName }}</span>
                                    </label>
                                </div>
                                <p v-else class="ai-ladder__rule" data-test="scope-empty">{{ chosenOnly && !projectQuery.trim() ? $t('Ai.scope_none_chosen') : $t('Ai.scope_no_match') }}</p>
                            </template>
                            <p v-else class="ai-ladder__rule">{{ $t('Ai.scope_no_projects') }}</p>
                        </section>
                    </div>

                    <div v-show="activeTab === 'autonomy'" id="agent-panel-autonomy" role="tabpanel" aria-labelledby="agent-tab-autonomy" class="ai-panel">
                        <section class="ah-card ai-agent">
                            <div class="ah-label">{{ $t('Ai.autonomy') }}</div>
                            <div class="ai-radios ai-radios--grid">
                                <label v-for="level in AUTONOMY_LEVELS" :key="level" class="ai-radio" :class="{ 'is-on': form.autonomy === level }" :title="autonomyTip(t, level)">
                                    <input v-model.number="form.autonomy" type="radio" :value="level" class="ah-check" :disabled="!canManage" />
                                    <span class="ai-radio__level"><strong>{{ autonomyName(t, level) }}</strong><span class="ah-small">{{ autonomyAbout(t, level) }}</span></span>
                                </label>
                            </div>
                            <p class="ai-ladder__rule">{{ $t('Ai.low_risk_note') }}</p>
                            <p class="ai-ladder__rule" data-test="project-stricter">{{ $t('Ai.project_may_be_stricter') }}</p>

                            <div class="ai-preview" data-test="l2-preview">
                                <div class="ah-label">{{ $t('Ai.acts_preview_title') }}</div>
                                <p class="ai-lead ai-panel__lead">{{ $t('Ai.l2_preview_lead') }}</p>
                                <div class="ai-preview__cols">
                                    <div class="ai-preview__col" data-test="l2-acts">
                                        <span class="ah-chip ah-chip--ok">{{ $t('Ai.l2_acts') }}</span>
                                        <p v-if="!preview.acts.length" class="ah-small ai-preview__none">{{ $t('Ai.l2_none_act') }}</p>
                                        <ul v-else class="ai-preview__list">
                                            <li v-for="item in preview.acts" :key="item.key"><span :title="item.key">{{ nameOfAction(item.key) }}</span><span class="ah-small">{{ $t(`Ai.l2_reason_${item.reason}`) }}</span></li>
                                        </ul>
                                    </div>
                                    <div class="ai-preview__col" data-test="l2-proposes">
                                        <span class="ah-chip ah-chip--warn">{{ $t('Ai.l2_proposes') }}</span>
                                        <p v-if="!preview.proposes.length" class="ah-small ai-preview__none">{{ $t('Ai.l2_none_propose') }}</p>
                                        <ul v-else class="ai-preview__list">
                                            <li v-for="item in preview.proposes" :key="item.key"><span :title="item.key">{{ nameOfAction(item.key) }}</span><span class="ah-small">{{ $t(`Ai.l2_reason_${item.reason}`) }}</span></li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                    <div v-show="activeTab === 'limits'" id="agent-panel-limits" role="tabpanel" aria-labelledby="agent-tab-limits" class="ai-panel">
                        <section class="ah-card ai-agent">
                            <div class="ah-label">{{ $t('Ai.runs_limits') }}</div>
                            <p class="ai-lead ai-panel__lead">{{ $t('Ai.runs_manual_note') }}</p>
                            <div class="ai-fields">
                                <div class="ah-field">
                                    <label class="ah-field__label" for="rate">{{ $t('Ai.rate_limit') }}</label>
                                    <input id="rate" v-model.number="form.rateLimitPerDay" type="number" min="0" max="500" class="ah-input" :disabled="!canManage" />
                                    <span class="ah-field__hint" data-test="rate-hint">{{ $t('Ai.rate_limit_hint') }}</span>
                                </div>
                                <div class="ah-field">
                                    <label class="ah-field__label" for="cap">{{ $t('Ai.spend_cap') }}</label>
                                    <input id="cap" v-model.number="form.spendCapUsd" type="number" min="0" step="1" class="ah-input" :disabled="!canManage" />
                                    <span class="ah-field__hint">{{ $t('Ai.cap_hint') }}</span>
                                </div>
                                <div class="ah-field">
                                    <label class="ah-field__label" for="model-pin">{{ $t('Ai.model_pin') }}</label>
                                    <select id="model-pin" v-model="form.model" class="ah-input" :disabled="!canManage" data-test="model-pin">
                                        <option value="">{{ $t('Ai.model_pin_none') }}</option>
                                        <option v-for="m in pinnableModels" :key="m.model" :value="m.model">{{ m.model }} · {{ m.provider }}</option>
                                    </select>
                                    <span class="ah-field__hint">{{ pinnableModels.length ? $t('Ai.model_pin_hint') : $t('Ai.model_pin_empty') }}</span>
                                </div>
                            </div>
                            <p v-if="spendRow" class="ai-ladder__rule ah-mono">{{ $t('Ai.spent_this_month', { usd: spendRow.usd.toFixed(2), runs: spendRow.runs }) }}</p>
                        </section>

                        <AgentSchedules
                            :agent-id="String(route.params.id)"
                            :autonomy="Number(saved.autonomy) || 0"
                            :can-manage="canManage"
                            :agent-owner-id="String(agent.ownerId || '')"
                            :project-ids="(agent.projectIds || []).map(String)"
                            :projects="projects"
                        />
                    </div>

                    <div v-if="canManage && SETTINGS_TABS.includes(activeTab)" class="ai-savebar" data-test="savebar">
                        <span v-if="error" class="ah-field__error ai-savebar__note">{{ error }}</span>
                        <span v-else-if="dirty" class="ai-savebar__note ai-savebar__note--dirty" data-test="unsaved">{{ $t('Ai.unsaved_changes') }}</span>
                        <span v-else class="ai-savebar__note">{{ $t('Ai.all_saved') }}</span>
                        <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AiHub', params: { cid: companyId } }">{{ $t('Ai.cancel') }}</router-link>
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="save" :disabled="busy" @click="save">{{ busy ? $t('Ai.saving') : $t('Ai.save') }}</button>
                    </div>

                    <div v-show="activeTab === 'runs'" id="agent-panel-runs" role="tabpanel" aria-labelledby="agent-tab-runs" class="ai-panel">
                        <section class="ah-card ai-agent">
                            <div class="ah-label">{{ $t('Ai.recent_audit') }}</div>
                            <div v-if="!recentRuns.length" class="ah-empty ai-panel__lead">{{ $t('Ai.no_runs') }}</div>
                            <ul v-else class="ai-audit">
                                <li v-for="run in recentRuns" :key="run._id" class="ai-audit__item">
                                    <div class="ai-audit__row">
                                        <span class="ah-mono ai-audit__at">{{ time(run.startedAt) }}</span>
                                        <span class="ai-audit__what">{{ run.skill ? skillLabel(t, run.skill) : run.trigger || $t('Ai.run') }}</span>
                                        <span class="ah-chip" :class="runChip(run)" data-test="run-status">{{ runStatus(run) }}</span>
                                        <SimulatedChip v-if="run.simulated" />
                                        <span v-if="run.revertedAt" class="ah-chip ah-chip--dark">{{ $t('Ai.reverted_chip') }}</span>
                                        <span v-if="refusalCount(run)" class="ah-chip ah-chip--warn">{{ $t('Ai.refused_n', { n: refusalCount(run) }) }}</span>
                                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="toggleRun(run._id)">{{ expandedRun === run._id ? $t('Ai.hide_details') : $t('Ai.run_details') }}</button>
                                    </div>
                                    <AgentRunDetail v-if="expandedRun === run._id" :run-id="run._id" @reverted="reloadRuns" />
                                </li>
                            </ul>
                        </section>
                    </div>

                    <div v-if="canManage" v-show="activeTab === 'history'" id="agent-panel-history" role="tabpanel" aria-labelledby="agent-tab-history" class="ai-panel">
                        <AgentRevisionHistory :key="revisionsKey" :agent-id="String(route.params.id)" :highlight="highlightRevision" @changed="load" />
                    </div>

                    <div v-if="canManage" v-show="activeTab === 'delete'" id="agent-panel-delete" role="tabpanel" aria-labelledby="agent-tab-delete" class="ai-panel">
                        <section class="ah-card ai-agent ai-danger" data-test="danger">
                            <div class="ah-label">{{ $t('Ai.delete_agent') }}</div>
                            <p class="ai-lead ai-panel__lead">{{ openRunCount ? t('Ai.delete_blocked_open_runs', { n: openRunCount }, openRunCount) : $t('Ai.delete_body') }}</p>
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
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { clockText } from "@/utils/clockText";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SimulatedChip from "@/components/atom/SimulatedChip/SimulatedChip.vue";
import AiSidebar from "./AiSidebar.vue";
import AgentRunDetail from "./AgentRunDetail.vue";
import AgentRevisionHistory from "./AgentRevisionHistory.vue";
import AgentSchedules from "./AgentSchedules.vue";
import { useAgents, refusalCount } from "./useAgents";
import { splitPreview } from "./policyPreview";
import { changedFields, formFromAgent, skillsPayload } from "./agentSavePatch";
import { useAgentAccess } from "./agentAccess";
import { actionLabel, autonomyAbout, autonomyName, autonomyTip, skillLabel } from "./plainLabels";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "AgentSettingsPage" });

const { t, te } = useI18n();
const $toast = useToast();
const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const companyId = inject("$companyId");
const { agents, spend, registryManifest, skillManifest, loadAgents, loadSpend, loadRegistry, loadSkills, saveAgent, setPaused, deleteAgent, activeRuns, loadActiveRuns } = useAgents();
const { canManage } = useAgentAccess();

const loadingAgent = ref(true);
const busy = ref(false);
const error = ref("");
const agent = ref({});
const skills = ref([]);
const namedKeys = ref(new Set());
const recentRuns = ref([]);
const deleteConfirm = ref("");
const form = reactive(formFromAgent({}));
const saved = ref({});
const projects = computed(() => (getters["projectData/projects"]?.data || []).filter((p) => !p.deletedStatusKey));
const pinnableModels = ref([]);
const roles = ref([]);
const openRunCount = computed(() => (activeRuns.value[String(route.params.id)] || []).length);

const AUTONOMY_LEVELS = computed(() => (registryManifest.value.autonomy || []).map((a) => a.level).slice(0, 4));
const nameOfAction = (key) => actionLabel(t, key, registryManifest.value.actions);
const never = computed(() => (registryManifest.value.never || []).map(nameOfAction).join(" · "));
const spendRow = computed(() => (spend.value.agents || []).find((a) => a.agentId === String(route.params.id)));
const expandedRun = ref("");
const revisionsKey = ref(0);
const highlightRevision = computed(() => { const n = Number(route.query.rev); return Number.isInteger(n) && n > 0 ? n : null; });

const TAB_FIELDS = { skills: ["skills"], projects: ["projectIds", "role"], autonomy: ["autonomy"], limits: ["rateLimitPerDay", "spendCapUsd", "model"] };
const SETTINGS_TABS = Object.keys(TAB_FIELDS);
const tabs = computed(() => [...SETTINGS_TABS, "runs", ...(canManage.value ? ["history", "delete"] : [])]);
// A run's detail links here with ?rev=N to show that revision.
const tab = ref(String(route.query.tab || (route.query.rev ? "history" : "skills")));
const activeTab = computed(() => (tabs.value.includes(tab.value) ? tab.value : "skills"));
// The revision link in a run's detail is on this page too, so the component stays mounted.
watch(() => [route.query.tab, route.query.rev], ([tabQuery, rev], [, previousRev]) => {
    if (rev && rev !== previousRev) tab.value = "history";
    else if (tabQuery) tab.value = String(tabQuery);
});
const pick = (key) => {
    if (key === activeTab.value) return;
    tab.value = key;
    router.replace({ query: { ...route.query, tab: key } });
};
const onTabKey = (event) => {
    const keys = tabs.value;
    const at = keys.indexOf(activeTab.value);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: keys.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const key = keys[(next + keys.length) % keys.length];
    pick(key);
    nextTick(() => document.getElementById(`agent-tab-${key}`)?.focus());
};

const skillsOnAtLoad = ref(new Set());
const orderedSkills = computed(() => [...skills.value].sort((a, b) => skillsOnAtLoad.value.has(b.key) - skillsOnAtLoad.value.has(a.key)));
const usedSkillCount = computed(() => skills.value.filter((s) => skillsOnAtLoad.value.has(s.key)).length);
const showLibrary = ref(false);

const projectQuery = ref("");
const chosenOnly = ref(false);
const isChosen = (p) => form.projectIds.includes(String(p._id));
const chosenCount = computed(() => projects.value.filter(isChosen).length);
const shownProjects = computed(() => {
    const query = projectQuery.value.trim().toLowerCase();
    const savedIds = new Set(saved.value.projectIds || []);
    return projects.value
        .filter((p) => (!chosenOnly.value || isChosen(p)) && (!query || String(p.ProjectName || "").toLowerCase().includes(query)))
        .sort((a, b) => savedIds.has(String(b._id)) - savedIds.has(String(a._id)));
});
const chooseShown = () => { form.projectIds = [...new Set([...form.projectIds, ...shownProjects.value.map((p) => String(p._id))])]; };

const tabCount = (key) => (key === "skills" ? skills.value.filter((s) => s.enabled).length : key === "projects" ? chosenCount.value : null);

/* What this agent would actually let the skill do: the skill's emits cut to the
 * agent's allowed actions. An agent with no allowed actions is un-narrowed. */
const effectiveOf = (skill) => {
    const emits = skill.emits || skill.actions || [];
    const allowed = agent.value.allowedActions || [];
    return allowed.length ? emits.filter((a) => allowed.includes(a)) : [...emits];
};
const outsideOf = (skill) => (skill.emits || []).filter((a) => !effectiveOf(skill).includes(a));

const allowedKeys = computed(() => {
    const keys = new Set();
    skills.value.filter((s) => s.enabled).forEach((s) => effectiveOf(s).forEach((a) => keys.add(a)));
    if (!keys.size) (agent.value.allowedActions || []).forEach((a) => keys.add(a));
    return [...keys];
});
const preview = computed(() => splitPreview(allowedKeys.value, registryManifest.value.actions));

const time = clockText;
const runStatus = (run) => (te(`Ai.run_status_${run.status}`) ? t(`Ai.run_status_${run.status}`) : run.status);
const runChip = (run) => (run.status === "failed" ? "ah-chip--danger" : run.status === "running" ? "ah-chip--brand" : run.status === "skipped" ? "ah-chip--warn" : "ah-chip--ok");
const toggleRun = (id) => { expandedRun.value = expandedRun.value === id ? "" : id; };

const loadPinnableModels = async () => {
    const res = await apiRequest("get", `${env.AGENT_MODELS}?configured=true`).catch(() => null);
    pinnableModels.value = res?.data?.status ? (res.data.data?.models || []) : [];
};

const loadRoles = async () => {
    const res = await apiRequest("get", env.AGENT_ROLES).catch(() => null);
    roles.value = res?.data?.status && res.data.data?.on !== false
        ? (res.data.data?.roles || []).map((role) => ({ id: `${role.blueprint}/${role.slug}`, name: role.name, department: role.department }))
        : [];
};

const reloadRuns = async () => {
    const res = await apiRequest("get", `${env.AGENT_RUNS}?agentId=${route.params.id}&limit=5`);
    if (res?.data?.status) recentRuns.value = res.data.data || [];
};

const load = async () => {
    await Promise.all([loadAgents(), loadSpend(), loadRegistry(), loadActiveRuns(), loadSkills().catch(() => [])]);
    const found = agents.value.find((a) => String(a._id) === String(route.params.id));
    if (!found) {
        router.replace({ name: "AiHub", params: { cid: companyId.value } });
        return;
    }
    agent.value = found;
    Object.assign(form, formFromAgent(found));
    // Every live skill in the manifest is offered; the ones this agent already
    // names keep their own state and sit first.
    const chosen = (found.skills || []).map((s) => ({
        key: s.key || String(s),
        name: s.name || s.key || String(s),
        emits: s.emits || s.actions || [],
        requires: s.requires || null,
        source: s.source || null,
        model: s.model || null,
        resolved: s.resolved !== false,
        enabled: s.enabled !== false
    }));
    const named = new Set(chosen.map((s) => s.key));
    namedKeys.value = named;
    const offered = (skillManifest.value || [])
        .filter((s) => !named.has(s.key) && !s.retiredAt && s.enabled !== false)
        .map((s) => ({ key: s.key, name: s.name, emits: s.emits || [], requires: s.requires || null, source: s.source, model: s.model || null, resolved: true, enabled: false }));
    skills.value = [...chosen, ...offered];
    skillsOnAtLoad.value = new Set(chosen.filter((s) => s.enabled).map((s) => s.key));
    saved.value = currentSettings();

    await Promise.all([reloadRuns(), loadPinnableModels(), loadRoles()]);
    loadingAgent.value = false;
};

// Actions are the manifest's to state, so only the skill choice is stored.
const currentSettings = () => JSON.parse(JSON.stringify({ ...form, skills: skillsPayload(skills.value, namedKeys.value) }));
// Unticking and re-ticking a project moves it to the end of the list; that alone is not a change.
const comparable = (settings) => ({ ...settings, projectIds: [...(settings.projectIds || [])].sort() });
const unsavedPatch = () => changedFields(comparable(saved.value), comparable(currentSettings()));

const unsavedFields = computed(() => (loadingAgent.value ? [] : Object.keys(unsavedPatch())));
const dirty = computed(() => unsavedFields.value.length > 0);
const dirtyTabs = computed(() => new Set(SETTINGS_TABS.filter((key) => TAB_FIELDS[key].some((field) => unsavedFields.value.includes(field)))));

const save = async () => {
    const current = currentSettings();
    const patch = unsavedPatch();
    if (!Object.keys(patch).length) {
        $toast.info(t("Ai.nothing_changed"), { position: "top-right" });
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        await saveAgent({ _id: agent.value._id, ...patch });
        saved.value = current;
        $toast.success(t("Ai.saved"), { position: "top-right" });
        revisionsKey.value += 1;
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
.ai-tabbar { padding: 8px 24px; border-bottom: 1px solid var(--hairline); background: var(--surface); overflow-x: auto; }
.ai-tabbar .ah-tabs { display: flex; width: max-content; }
.ai-tabbar__tab { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.ai-tabbar__tab--danger { color: var(--danger-ink); }
.ai-tabbar__count { font: var(--text-data); color: var(--ink-2); }
.ai-tabbar__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.ai-settings { max-width: 920px; display: flex; flex-direction: column; gap: 12px; }
.ai-settings > .ah-chip { align-self: flex-start; }
.ai-panel { display: flex; flex-direction: column; gap: 12px; }
.ai-panel__lead { margin: 6px 0 10px; }
.ai-skill { padding: 9px 0; border-bottom: 1px solid var(--hairline); }
.ai-skill__head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.ai-skill__name { font: 600 13px/1.2 var(--font-ui); cursor: pointer; }
.ai-radio__level { display: flex; flex-direction: column; gap: 2px; }
.ai-skill__actions { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0 0 24px; }
.ai-skill__outside { opacity: .5; text-decoration: line-through; }
.ai-skill__needs { margin: 5px 0 0 24px; }
.ai-skills__more { align-self: flex-start; margin: 8px 0 2px; }
.ai-skills__chev { display: inline-flex; transition: transform var(--t-state) var(--ease); }
.ai-skills__chev.is-open { transform: rotate(180deg); }
.ai-skills__foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-top: 10px; }
.ai-skills__foot .ah-small { margin: 0; flex: 1; min-width: 220px; }
.ai-never { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--hairline); font: var(--text-small); color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
.ai-never strong { color: var(--ink); }
.ai-scope__tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.ah-input.ai-scope__search { flex: 1 1 220px; min-width: 0; }
.ai-scope__count { color: var(--ink-2); white-space: nowrap; }
.ai-scope__grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); gap: 2px 10px;
    max-height: 360px; overflow-y: auto; padding: 6px; border: 1px solid var(--hairline); border-radius: var(--r-input);
}
.ai-scope__item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; border-radius: var(--r-chip); cursor: pointer; font: var(--text-small); color: var(--ink); }
.ai-scope__item:hover { background: var(--surface-hover); }
.ai-scope__item.is-on { background: var(--brand-tint); }
.ai-scope__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-radios { display: flex; flex-direction: column; gap: 7px; margin: 8px 0 10px; }
.ai-radios--grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.ai-radio { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: 1.5px solid var(--border); border-radius: 9px; cursor: pointer; font: var(--text-body); }
.ai-radio.is-on { border-color: var(--brand); background: var(--brand-tint); }
.ai-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 10px; }
.ai-savebar {
    position: sticky; bottom: -20px; z-index: 2; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
    margin-bottom: -20px; padding: 10px 14px; border: 1px solid var(--hairline); border-radius: var(--r-card) var(--r-card) 0 0;
    background: var(--surface); box-shadow: var(--shadow-pop);
}
.ai-savebar__note { flex: 1; min-width: 0; margin: 0; font: var(--text-small); color: var(--ink-2); }
.ai-savebar__note--dirty { color: var(--warn-ink); font-weight: 600; }
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
.ai-audit__at { color: var(--ink-2); }
.ai-audit__what { flex: 1; min-width: 0; color: var(--ink); }
.ai-danger { border-color: var(--danger-ink); }
@media (max-width: 767px) {
    .ai-tabbar { padding: 8px 16px; }
    .ai-radios--grid { grid-template-columns: 1fr; }
}
</style>
