<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('TeamPacks.title') }}</div>
            </div>

            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('TeamPacks.lead') }}</p>

                <p v-if="loading" class="ah-empty">{{ $t('TeamPacks.loading') }}</p>
                <EmptyState v-else-if="loadError" :title="$t('TeamPacks.load_failed')" :message="loadError" :action-label="$t('TeamPacks.retry')" @action="load" />
                <div v-else class="tp-wrap">
                    <p v-if="!dispatcherOn" class="ah-small tp-note" data-test="tp-off" role="status">{{ $t('TeamPacks.dispatcher_off') }}</p>
                    <p v-if="needsKey" class="ah-small tp-note" data-test="tp-needs-key">{{ $t('AgentCatalogue.role_needs_key') }}</p>

                    <BlueprintPicker :team-packs="teamPacks" :show-off-note="false" />

                    <section class="ah-card tp-card">
                        <div class="ah-card__body tp-form">
                            <header class="tp-head">
                                <h2 class="ah-h3 tp-title">{{ $t('TeamPacks.pack_title') }}</h2>
                                <p class="ah-small tp-muted">{{ $t('TeamPacks.pack_lead') }}</p>
                            </header>

                            <div class="tp-field tp-field--narrow">
                                <label class="ah-field__label" for="tp-blueprint">{{ $t('TeamPacks.blueprint_label') }}</label>
                                <select id="tp-blueprint" v-model="blueprint" class="ah-input" data-test="tp-blueprint">
                                    <option v-for="pack in packs" :key="pack.blueprint" :value="pack.blueprint">{{ blueprintName(t, te, pack.blueprint) }}</option>
                                </select>
                            </div>

                            <fieldset class="tp-field tp-set">
                                <legend class="ah-field__label">{{ $t('TeamPacks.teams_label') }}</legend>
                                <div class="tp-teams">
                                    <label v-for="team in teamsOfPack" :key="team.team" class="tp-team" :class="{ 'tp-team--on': teams.includes(team.team) }" data-test="tp-team">
                                        <input v-model="teams" class="ah-check" type="checkbox" :value="team.team" />
                                        <span class="tp-team__text">
                                            <span class="tp-team__name">{{ teamName(t, te, team.team) }}</span>
                                            <span class="ah-small tp-muted">{{ team.roles.map((role) => role.name).join(' · ') }}</span>
                                        </span>
                                    </label>
                                </div>
                            </fieldset>

                            <PackProjectPicker
                                v-model="projectIds"
                                :projects="projects"
                                :max="MAX_PROJECTS"
                                test-id="tp-project"
                                :empty-text="$t('TeamPacks.no_projects')"
                                :hint="$t('TeamPacks.projects_hint')"
                            />

                            <div v-if="starterRuleCount || managesAgents || tagNames.length || fieldNames.length" class="tp-options">
                                <label v-if="starterRuleCount" class="tp-option">
                                    <input v-model="withStarterRules" class="ah-check" type="checkbox" data-test="tp-starter-rules" />
                                    <span class="tp-option__text">
                                        <span class="tp-option__name">{{ $t('TeamPacks.starter_rules') }}</span>
                                        <span class="ah-small tp-muted" data-test="tp-starter-rules-hint">{{ $t('TeamPacks.starter_rules_hint', { n: starterRuleCount }, starterRuleCount) }}<template v-if="hasTypeRule"> {{ $t('TeamPacks.starter_rules_type_hint') }}</template></span>
                                    </span>
                                </label>
                                <label v-if="managesAgents" class="tp-option" data-test="tp-create-agents">
                                    <input v-model="createAgents" class="ah-check" type="checkbox" />
                                    <span class="tp-option__text">
                                        <span class="tp-option__name">{{ $t('TeamPacks.create_agents') }}</span>
                                        <span class="ah-small tp-muted">{{ $t('TeamPacks.create_agents_paused_hint') }}</span>
                                    </span>
                                </label>
                                <p v-if="tagNames.length" class="ah-small tp-muted tp-option__note" data-test="tp-tags-hint">{{ $t('TeamPacks.tags_hint', { names: tagNames.join(', ') }) }}</p>
                                <p v-if="fieldNames.length" class="ah-small tp-muted tp-option__note" data-test="tp-fields-hint">{{ $t('TeamPacks.fields_hint', { names: fieldNames.join(', ') }) }}</p>
                            </div>

                            <div class="tp-actions">
                                <button
                                    type="button"
                                    class="ah-btn ah-btn--primary ah-btn--sm"
                                    data-test="tp-apply"
                                    :disabled="busy || !dispatcherOn || !roleCount || !projectIds.length"
                                    @click="apply"
                                >{{ busy ? $t('TeamPacks.applying') : $t('TeamPacks.apply', { n: roleCount }, roleCount) }}</button>
                                <span class="ah-small tp-muted">{{ $t('TeamPacks.nothing_runs') }}</span>
                            </div>
                            <p v-if="error" class="ah-field__error" role="alert" data-test="tp-error">{{ error }}</p>
                        </div>
                    </section>

                    <section v-if="result" class="ah-card tp-card" data-test="tp-result" aria-live="polite">
                        <div class="ah-card__body tp-form">
                            <p class="tp-result__head">{{ resultHead }}</p>
                            <ul class="tp-list">
                                <li v-for="project in result.projects" :key="project.projectId" class="ah-small" :data-mode="project.mode">{{ projectLine(project) }}</li>
                            </ul>
                            <p v-if="undone && undoneFieldsKept" class="ah-small tp-muted" data-test="tp-fields-kept">{{ $t('TeamPacks.fields_kept') }}</p>
                            <p v-if="agentLine" class="ah-small tp-muted" data-test="tp-agents">{{ agentLine }}</p>
                            <p v-if="!undone && madeAgents.length" class="ah-small tp-muted" data-test="tp-agents-paused">{{ $t('TeamPacks.agents_paused_note') }}</p>
                            <ul v-if="keptAgents.length" class="tp-list" data-test="tp-kept">
                                <li v-for="agent in keptAgents" :key="agent.agentId" class="ah-small">{{ $t(KEPT_WHY[agent.why] || 'TeamPacks.agent_kept', { name: agent.name }) }}</li>
                            </ul>
                            <div v-if="!undone && (changedCount || madeAgents.length)" class="tp-actions">
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="tp-undo" :disabled="busy" @click="undo">
                                    {{ busy ? $t('TeamPacks.undoing') : $t('TeamPacks.undo') }}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import AiSidebar from "./AiSidebar.vue";
import BlueprintPicker from "./BlueprintPicker.vue";
import PackProjectPicker from "./PackProjectPicker.vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { aiAvailability, AI_STATE } from "@/composable/aiAvailability";
import { refusalText } from "@/utils/assignmentRules";
import { useCustomComposable } from "@/composable";
import { isOwnerOrAdmin } from "@/utils/roles";
import { applyTeamPack, blueprintName, fetchTeamPacks, fieldsKeptAfterUndo, packProjectLine, roleNamesOf, teamName, undoTeamPack } from "@/utils/dispatcher";

defineOptions({ name: "AiTeamPacks" });

const OFF = 409;
const MAX_PROJECTS = 50;
const DETAILS = "project.project_details";

const { t, te } = useI18n();
const route = useRoute();
const { getters } = useStore();
const { checkPermission } = useCustomComposable();

const loading = ref(true);
const loadError = ref("");
const packs = ref([]);
const teamPacks = ref(null);
const dispatcherOn = ref(false);
const blueprint = ref("");
const teams = ref([]);
const projectIds = ref([]);
const busy = ref(false);
const error = ref("");
const result = ref(null);
const undone = ref(false);
const withStarterRules = ref(true);
const undoneKept = ref([]);
const undoneFieldsKept = ref(false);
const createAgents = ref(true);

const KEPT_WHY = Object.freeze({ running: "TeamPacks.agent_kept_running", edited: "TeamPacks.agent_kept_edited" });
const managesAgents = computed(() => isOwnerOrAdmin(getters["settings/companyUserDetail"]?.roleType));
const needsKey = computed(() => aiAvailability.state === AI_STATE.UNCONFIGURED);
/* The server checks every project again; this only keeps out of reach what it would refuse. A project with its own
 * roles is judged by rules this page does not hold, so only an owner or admin is offered it here. */
const whyNot = (project) => {
    if (isOwnerOrAdmin(getters["settings/companyUserDetail"]?.roleType)) return "";
    if (project.isGlobalPermission === false) return "own_roles";
    return checkPermission(DETAILS, true) === true ? "" : "no_permission";
};
const projects = computed(() => (getters["projectData/projects"]?.data || [])
    .filter((p) => !p.deletedStatusKey && p.isPersonal !== true)
    .map((p) => ({ id: String(p._id), name: p.ProjectName, why: whyNot(p) })));
const teamsOfPack = computed(() => (packs.value.find((pack) => pack.blueprint === blueprint.value) || { teams: [] }).teams);
const roleCount = computed(() => teamsOfPack.value.filter((team) => teams.value.includes(team.team)).reduce((sum, team) => sum + team.roles.length, 0));
const chosenRoles = computed(() => teamsOfPack.value.filter((team) => teams.value.includes(team.team)).flatMap((team) => team.roles));
const hasTypeRule = computed(() => chosenRoles.value.some((role) => (role.starterRules || []).some((rule) => rule.kind === "type")));
const starterRuleCount = computed(() => chosenRoles.value.reduce((sum, role) => sum + (role.starterRules || []).length, 0));
const tagNames = computed(() => {
    const names = chosenRoles.value.flatMap((role) => role.tags || []);
    return names.filter((name, at) => names.findIndex((one) => one.toLowerCase() === name.toLowerCase()) === at);
});
const fieldNames = computed(() => {
    const names = chosenRoles.value.flatMap((role) => (role.fields || []).map((field) => field.name));
    return names.filter((name, at) => names.findIndex((one) => one.toLowerCase() === name.toLowerCase()) === at);
});
const ruleCount = computed(() => (result.value?.projects || []).reduce((sum, project) => sum + (project.rules || []).length, 0));
const addedCount = computed(() => (result.value?.projects || []).reduce((sum, project) => sum + (project.added || []).length, 0));
const changedCount = computed(() => addedCount.value + ruleCount.value + (result.value?.projects || []).filter((project) => project.proposalId || project.fieldProposalId || project.modeWas).length);
const madeAgents = computed(() => result.value?.agents?.made || []);
const keptAgents = computed(() => (undone.value ? undoneKept.value : []));
const agentLine = computed(() => {
    if (undone.value) return undoneKept.value.length ? t("TeamPacks.agents_undone_some_kept", { n: undoneKept.value.length }, undoneKept.value.length) : t("TeamPacks.agents_undone");
    const made = madeAgents.value.length;
    const reused = result.value?.agents?.kept?.length || 0;
    if (!made && !reused) return "";
    return t("TeamPacks.agents_made", { n: made, reused }, made);
});
const projectName = (id) => (projects.value.find((p) => p.id === String(id)) || {}).name || id;

const proposedCount = computed(() => (result.value?.projects || []).reduce((sum, project) => sum + (project.tags || []).length + (project.fields || []).length, 0));

const resultHead = computed(() => {
    if (undone.value) return t("TeamPacks.undone");
    if (addedCount.value) return t("TeamPacks.applied", { n: addedCount.value }, addedCount.value);
    return ruleCount.value || proposedCount.value ? t("TeamPacks.roles_were_on") : t("TeamPacks.nothing_new");
});

const roleName = computed(() => roleNamesOf(packs.value.flatMap((pack) => pack.teams.flatMap((team) => team.roles))));
const projectLine = (project) => packProjectLine(t, project, projectName(project.projectId), roleName.value);

watch(blueprint, () => {
    const known = teamsOfPack.value.map((team) => team.team);
    teams.value = teams.value.filter((team) => known.includes(team));
});

const failText = (e, fallback) => (e?.response?.status === OFF ? t("TeamPacks.dispatcher_off") : refusalText(e, fallback));

async function load() {
    loading.value = true;
    loadError.value = "";
    try {
        const data = await fetchTeamPacks();
        teamPacks.value = data || null;
        packs.value = data?.packs || [];
        dispatcherOn.value = Boolean(data?.on);
        const asked = String(route?.query?.blueprint || "");
        blueprint.value = packs.value.some((pack) => pack.blueprint === asked) ? asked : packs.value[0]?.blueprint || "";
        const team = String(route?.query?.team || "");
        if (team && teamsOfPack.value.some((one) => one.team === team)) teams.value = [team];
    } catch (e) {
        loadError.value = refusalText(e, t("TeamPacks.load_failed"));
    } finally {
        loading.value = false;
    }
}

async function apply() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
        result.value = await applyTeamPack({
            blueprint: blueprint.value,
            teams: teams.value,
            projectIds: projectIds.value,
            starterRules: withStarterRules.value && starterRuleCount.value > 0,
            proposeTags: tagNames.value.length > 0,
            proposeFields: fieldNames.value.length > 0,
            createAgents: managesAgents.value && createAgents.value
        });
        undone.value = false;
        undoneKept.value = [];
        undoneFieldsKept.value = false;
    } catch (e) {
        error.value = failText(e, t("TeamPacks.failed"));
    } finally {
        busy.value = false;
    }
}

async function undo() {
    if (busy.value || !result.value) return;
    busy.value = true;
    error.value = "";
    try {
        const answer = await undoTeamPack(result.value);
        undoneKept.value = answer?.agents?.kept || [];
        undoneFieldsKept.value = fieldsKeptAfterUndo([answer]);
        undone.value = true;
    } catch (e) {
        error.value = failText(e, t("TeamPacks.undo_failed"));
    } finally {
        busy.value = false;
    }
}

onMounted(load);
</script>

<style>
@import "./style.css";
.tp-note { margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--warn); border-radius: var(--r-card); background: var(--warn-bg); color: var(--warn-ink); }
.tp-card { margin-bottom: 16px; }
.tp-wrap { max-width: 960px; }
.tp-form { display: flex; flex-direction: column; gap: 18px; }
.tp-head { display: flex; flex-direction: column; gap: 4px; padding-bottom: 14px; border-bottom: 1px solid var(--hairline); }
.tp-title { margin: 0; }
.tp-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tp-field--narrow { max-width: 280px; }
.tp-set { margin: 0; padding: 0; border: 0; }
.tp-teams { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.tp-team { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface); cursor: pointer; color: var(--ink); min-width: 0; transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease); }
.tp-team:hover { border-color: var(--brand-border); }
.tp-team--on { border-color: var(--brand); background: var(--brand-tint); }
.tp-team .ah-check, .tp-option .ah-check { flex: none; margin-top: 2px; }
.tp-team__text, .tp-option__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tp-team__name, .tp-option__name { font-weight: 600; }
.tp-options { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border-radius: var(--r-card); background: var(--surface-2); }
.tp-option { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; color: var(--ink); }
.tp-option__note { margin: 0; }
.tp-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding-top: 14px; border-top: 1px solid var(--hairline); }
.tp-muted { color: var(--ink-2); }
.tp-result__head { margin: 0; font-weight: 600; color: var(--ink); }
.tp-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--ink-2); }
@media (max-width: 480px) {
    .tp-field--narrow { max-width: none; }
    .tp-actions .ah-btn { width: 100%; }
}
</style>
