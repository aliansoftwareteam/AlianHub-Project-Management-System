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
                <template v-else>
                    <p v-if="!dispatcherOn" class="ah-small tp-note" data-test="tp-off" role="status">{{ $t('TeamPacks.dispatcher_off') }}</p>
                    <p v-if="needsKey" class="ah-small tp-note" data-test="tp-needs-key">{{ $t('AgentCatalogue.role_needs_key') }}</p>

                    <BlueprintPicker :team-packs="teamPacks" />

                    <section class="ah-card tp-card">
                        <div class="ah-card__body tp-form">
                            <div class="tp-field">
                                <label class="ah-field__label" for="tp-blueprint">{{ $t('TeamPacks.blueprint_label') }}</label>
                                <select id="tp-blueprint" v-model="blueprint" class="ah-input" data-test="tp-blueprint">
                                    <option v-for="pack in packs" :key="pack.blueprint" :value="pack.blueprint">{{ blueprintName(t, te, pack.blueprint) }}</option>
                                </select>
                            </div>

                            <fieldset class="tp-field tp-set">
                                <legend class="ah-field__label">{{ $t('TeamPacks.teams_label') }}</legend>
                                <label v-for="team in teamsOfPack" :key="team.team" class="tp-row" data-test="tp-team">
                                    <input v-model="teams" class="ah-check" type="checkbox" :value="team.team" />
                                    <span class="tp-row__name">{{ teamName(t, te, team.team) }}</span>
                                    <span class="ah-small tp-row__roles">{{ team.roles.map((role) => role.name).join(' · ') }}</span>
                                </label>
                            </fieldset>

                            <fieldset class="tp-field tp-set">
                                <legend class="ah-field__label">{{ $t('TeamPacks.projects_label') }}</legend>
                                <p v-if="!projects.length" class="ah-small">{{ $t('TeamPacks.no_projects') }}</p>
                                <div class="tp-projects">
                                    <label
                                        v-for="project in projects"
                                        :key="project._id"
                                        class="tp-row"
                                        :class="{ 'tp-row--off': project.why }"
                                        data-test="tp-project"
                                        :data-why="project.why || null"
                                    >
                                        <input
                                            v-model="projectIds"
                                            class="ah-check"
                                            type="checkbox"
                                            :value="project.id"
                                            :disabled="Boolean(project.why) || (atCap && !projectIds.includes(project.id))"
                                        />
                                        <span class="tp-row__name">{{ project.name }}</span>
                                        <span v-if="project.why" class="ah-small tp-row__roles">{{ $t(`TeamPacks.why_${project.why}`) }}</span>
                                    </label>
                                </div>
                                <span class="ah-field__hint" data-test="tp-projects-hint">{{ atCap ? $t('TeamPacks.projects_cap', { n: MAX_PROJECTS }) : $t('TeamPacks.projects_hint') }}</span>
                            </fieldset>

                            <label class="tp-row" data-test="tp-create-agents">
                                <input v-model="createAgents" class="ah-check" type="checkbox" />
                                <span class="tp-row__name">{{ $t('TeamPacks.create_agents') }}</span>
                                <span class="ah-small tp-row__roles">{{ $t('TeamPacks.create_agents_hint') }}</span>
                            </label>

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
                            <p v-if="agentLine" class="ah-small tp-muted" data-test="tp-agents">{{ agentLine }}</p>
                            <ul v-if="keptAgents.length" class="tp-list" data-test="tp-kept">
                                <li v-for="agent in keptAgents" :key="agent.agentId" class="ah-small">{{ $t('TeamPacks.agent_kept', { name: agent.name }) }}</li>
                            </ul>
                            <div v-if="!undone && (addedCount || madeAgents.length)" class="tp-actions">
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="tp-undo" :disabled="busy" @click="undo">
                                    {{ busy ? $t('TeamPacks.undoing') : $t('TeamPacks.undo') }}
                                </button>
                            </div>
                        </div>
                    </section>
                </template>
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
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { aiAvailability, AI_STATE } from "@/composable/aiAvailability";
import { refusalText } from "@/utils/assignmentRules";
import { useCustomComposable } from "@/composable";
import { isOwnerOrAdmin } from "@/utils/roles";
import { applyTeamPack, blueprintName, fetchTeamPacks, teamName, undoTeamPack } from "@/utils/dispatcher";

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
const undoneKept = ref([]);
const createAgents = ref(true);

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
const atCap = computed(() => projectIds.value.length >= MAX_PROJECTS);
const teamsOfPack = computed(() => (packs.value.find((pack) => pack.blueprint === blueprint.value) || { teams: [] }).teams);
const roleCount = computed(() => teamsOfPack.value.filter((team) => teams.value.includes(team.team)).reduce((sum, team) => sum + team.roles.length, 0));
const addedCount = computed(() => (result.value?.projects || []).reduce((sum, project) => sum + (project.added || []).length, 0));
const madeAgents = computed(() => result.value?.agents?.made || []);
const keptAgents = computed(() => (undone.value ? undoneKept.value : []));
const agentLine = computed(() => {
    if (undone.value) return undoneKept.value.length ? t("TeamPacks.agents_undone_kept", { n: undoneKept.value.length }, undoneKept.value.length) : t("TeamPacks.agents_undone");
    const made = madeAgents.value.length;
    const reused = result.value?.agents?.kept?.length || 0;
    if (!made && !reused) return "";
    return t("TeamPacks.agents_made", { n: made, reused }, made);
});
const projectName = (id) => (projects.value.find((p) => p.id === String(id)) || {}).name || id;

const resultHead = computed(() => {
    if (undone.value) return t("TeamPacks.undone");
    return addedCount.value ? t("TeamPacks.applied", { n: addedCount.value }, addedCount.value) : t("TeamPacks.nothing_new");
});

const projectLine = (project) => {
    const name = projectName(project.projectId);
    if (project.mode === "off") return t("TeamPacks.project_off", { project: name });
    return t("TeamPacks.project_on", { project: name, mode: t(`TeamPacks.mode_${project.mode}`) });
};

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
        result.value = await applyTeamPack({ blueprint: blueprint.value, teams: teams.value, projectIds: projectIds.value, createAgents: createAgents.value });
        undone.value = false;
        undoneKept.value = [];
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
.tp-note { margin: 0 0 12px; padding: 8px 12px; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface-2); color: var(--ink-2); }
.tp-card { margin-bottom: 14px; }
.tp-form { display: flex; flex-direction: column; gap: 14px; }
.tp-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tp-set { margin: 0; padding: 0; border: 0; }
.tp-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; cursor: pointer; color: var(--ink); }
.tp-row__name { font-weight: 600; }
.tp-row--off { cursor: default; color: var(--ink-2); }
.tp-row__roles { flex-basis: 100%; padding-left: 24px; color: var(--ink-2); }
.tp-projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
.tp-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tp-muted { color: var(--ink-2); }
.tp-result__head { margin: 0; font-weight: 600; color: var(--ink); }
.tp-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--ink-2); }
@media (max-width: 480px) {
    .tp-projects { grid-template-columns: 1fr; }
    .tp-actions .ah-btn { width: 100%; }
}
</style>
