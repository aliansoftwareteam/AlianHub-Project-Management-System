<template>
    <section class="ah-card bp" data-test="blueprint-picker">
        <div class="ah-card__body bp__body">
            <div>
                <h2 class="ah-h3">{{ $t('CompanyBlueprint.title') }}</h2>
                <p class="ah-small bp__muted">{{ $t('CompanyBlueprint.lead') }}</p>
            </div>

            <p v-if="loading" class="ah-empty">{{ $t('CompanyBlueprint.loading') }}</p>
            <p v-else-if="loadError" class="ah-field__error" role="alert" data-test="bp-load-error">{{ loadError }}</p>
            <template v-else-if="industries.length">
                <p v-if="!dispatcherOn" class="ah-small bp__note" data-test="bp-off" role="status">{{ $t('TeamPacks.dispatcher_off') }}</p>

                <div class="bp__field">
                    <label class="ah-field__label" for="bp-industry">{{ $t('CompanyBlueprint.industry_label') }}</label>
                    <select id="bp-industry" v-model="industryId" class="ah-input" data-test="bp-industry">
                        <option v-for="one in industries" :key="one.id" :value="one.id">{{ blueprintName(t, te, one.id) }}</option>
                    </select>
                </div>

                <fieldset class="bp__field bp__set">
                    <legend class="ah-field__label">{{ $t('CompanyBlueprint.size_label') }}</legend>
                    <div class="bp__sizes" role="radiogroup">
                        <label v-for="one in COMPANY_SIZES" :key="one" class="bp__size" :class="{ 'bp__size--on': size === one }" data-test="bp-size">
                            <input v-model="size" class="bp__radio" type="radio" name="bp-size" :value="one" />
                            <span class="bp__size-name">{{ $t(`CompanyBlueprint.size_${one}`) }}</span>
                            <span class="ah-small bp__muted">{{ $t('CompanyBlueprint.people', { from: peopleOf(one)[0], to: peopleOf(one)[1] }) }}</span>
                        </label>
                    </div>
                </fieldset>

                <div v-if="current" class="bp__plan" data-test="bp-plan">
                    <p class="bp__line" data-test="bp-seats">{{ $t('CompanyBlueprint.counts', { roles: current.roles.length, from: current.seats[0], to: current.seats[1] }) }}</p>
                    <p class="ah-small bp__muted">{{ $t('CompanyBlueprint.seats_hint') }}</p>

                    <h3 class="ah-label">{{ $t('CompanyBlueprint.teams_title') }}</h3>
                    <div class="bp__chips" data-test="bp-teams">
                        <span v-for="team in current.teams" :key="team" class="ah-chip ah-chip--sm">{{ teamName(t, te, team) }}</span>
                    </div>

                    <h3 class="ah-label">{{ $t('CompanyBlueprint.roles_title') }}</h3>
                    <ol class="bp__roles">
                        <li v-for="(role, index) in current.roles" :key="role.name" class="bp__role" :class="{ 'bp__role--start': index < STARTER }" data-test="bp-role">
                            <span class="bp__role-name">{{ role.name }}</span>
                            <span class="ah-small bp__muted">{{ teamName(t, te, role.team) }}</span>
                            <span v-if="index < STARTER" class="ah-chip ah-chip--sm ah-chip--brand">{{ $t('CompanyBlueprint.starter') }}</span>
                            <span v-if="!role.key" class="ah-small bp__muted">{{ $t('CompanyBlueprint.not_written') }}</span>
                        </li>
                    </ol>
                </div>

                <fieldset class="bp__field bp__set">
                    <legend class="ah-field__label">{{ $t('TeamPacks.projects_label') }}</legend>
                    <p v-if="!projects.length" class="ah-small bp__muted" data-test="bp-no-projects">{{ $t('CompanyBlueprint.no_projects') }}</p>
                    <div class="bp__projects">
                        <label v-for="project in projects" :key="project.id" class="bp__project" :class="{ 'bp__project--off': project.why }" data-test="bp-project">
                            <input v-model="projectIds" class="ah-check" type="checkbox" :value="project.id" :disabled="Boolean(project.why) || (atCap && !projectIds.includes(project.id))" />
                            <span class="bp__role-name">{{ project.name }}</span>
                            <span v-if="project.why" class="ah-small bp__muted">{{ $t(`TeamPacks.why_${project.why}`) }}</span>
                        </label>
                    </div>
                </fieldset>

                <p v-if="current && !startCount" class="ah-small bp__note" data-test="bp-none-written" role="status">{{ $t('CompanyBlueprint.none_written') }}</p>
                <p v-else-if="current && startCount < STARTER" class="ah-small bp__muted" data-test="bp-some-written">{{ $t('CompanyBlueprint.some_written', { n: startCount, total: STARTER }) }}</p>

                <div class="bp__actions">
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="bp-apply" :disabled="busy || !dispatcherOn || !startCount || !projectIds.length" @click="apply">
                        {{ busy ? $t('TeamPacks.applying') : $t('CompanyBlueprint.apply', { n: startCount }, startCount) }}
                    </button>
                    <span class="ah-small bp__muted">{{ $t('CompanyBlueprint.suggest_only') }}</span>
                </div>
                <p v-if="error" class="ah-field__error" role="alert" data-test="bp-error">{{ error }}</p>

                <div v-if="results" class="bp__result" data-test="bp-result" aria-live="polite">
                    <p class="bp__line">{{ resultHead }}</p>
                    <ul class="bp__list">
                        <li v-for="project in resultProjects" :key="project.projectId" class="ah-small" :data-mode="project.mode">{{ projectLine(project) }}</li>
                    </ul>
                    <button v-if="!undone && addedCount" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="bp-undo" :disabled="busy" @click="undo">
                        {{ busy ? $t('TeamPacks.undoing') : $t('TeamPacks.undo') }}
                    </button>
                </div>
            </template>
        </div>
    </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { refusalText } from "@/utils/assignmentRules";
import { useCustomComposable } from "@/composable";
import { isOwnerOrAdmin } from "@/utils/roles";
import { applyStarterRoles, blueprintName, COMPANY_SIZES, fetchTeamPacks, teamName, undoStarterRoles } from "@/utils/dispatcher";

defineOptions({ name: "BlueprintPicker" });

const props = defineProps({ teamPacks: { type: Object, default: null } });
const emit = defineEmits(["loaded"]);

const OFF = 409;
const MAX_PROJECTS = 50;
const STARTER = 3;
const DETAILS = "project.project_details";

const { t, te } = useI18n();
const { getters } = useStore();
const { checkPermission } = useCustomComposable();

const loading = ref(true);
const loadError = ref("");
const industries = ref([]);
const dispatcherOn = ref(false);
const industryId = ref("");
const size = ref("small");
const projectIds = ref([]);
const busy = ref(false);
const error = ref("");
const results = ref(null);
const undone = ref(false);

/* The server checks every project again; this only keeps out of reach what it would refuse. */
const whyNot = (project) => {
    if (isOwnerOrAdmin(getters["settings/companyUserDetail"]?.roleType)) return "";
    if (project.isGlobalPermission === false) return "own_roles";
    return checkPermission(DETAILS, true) === true ? "" : "no_permission";
};
const projects = computed(() => (getters["projectData/projects"]?.data || [])
    .filter((p) => !p.deletedStatusKey && p.isPersonal !== true)
    .map((p) => ({ id: String(p._id), name: p.ProjectName, why: whyNot(p) })));
const atCap = computed(() => projectIds.value.length >= MAX_PROJECTS);
const current = computed(() => industries.value.find((one) => one.id === industryId.value)?.sizes[size.value] || null);
const peopleOf = (one) => industries.value.find((it) => it.id === industryId.value)?.sizes[one]?.people || [0, 0];
const groups = computed(() => current.value?.packs || []);
const startCount = computed(() => groups.value.reduce((sum, group) => sum + group.roles.length, 0));
const resultProjects = computed(() => (results.value || []).flatMap((one) => one.projects));
const addedCount = computed(() => resultProjects.value.reduce((sum, project) => sum + (project.added || []).length, 0));
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

const failText = (e, fallback) => (e?.response?.status === OFF ? t("TeamPacks.dispatcher_off") : refusalText(e, fallback));

async function load() {
    loading.value = true;
    loadError.value = "";
    try {
        const data = props.teamPacks || await fetchTeamPacks();
        industries.value = data?.companyBlueprints || [];
        dispatcherOn.value = Boolean(data?.on);
        industryId.value = industries.value[0]?.id || "";
    } catch (e) {
        loadError.value = refusalText(e, t("CompanyBlueprint.load_failed"));
    } finally {
        loading.value = false;
        emit("loaded", { on: dispatcherOn.value, failed: Boolean(loadError.value) });
    }
}

async function apply() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
        results.value = await applyStarterRoles(groups.value, projectIds.value);
        undone.value = false;
    } catch (e) {
        error.value = failText(e, t("TeamPacks.failed"));
    } finally {
        busy.value = false;
    }
}

async function undo() {
    if (busy.value || !results.value) return;
    busy.value = true;
    error.value = "";
    try {
        await undoStarterRoles(results.value);
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
.bp { margin-bottom: 14px; }
.bp__body { display: flex; flex-direction: column; gap: 14px; }
.bp__muted { color: var(--ink-2); }
.bp__note { margin: 0; padding: 8px 12px; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface-2); color: var(--ink-2); }
.bp__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.bp__set { margin: 0; padding: 0; border: 0; }
.bp__sizes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.bp__size { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface); color: var(--ink); cursor: pointer; min-width: 0; }
.bp__size--on { border-color: var(--brand); background: var(--surface-2); }
.bp__size-name { font-weight: 600; }
.bp__size { position: relative; }
.bp__size:focus-within { outline: 2px solid var(--brand); outline-offset: 2px; }
.bp__radio { position: absolute; opacity: 0; pointer-events: none; }
.bp__plan { display: flex; flex-direction: column; gap: 8px; }
.bp__line { margin: 0; font-weight: 600; color: var(--ink); }
.bp__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bp__roles { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; color: var(--ink); }
.bp__role { display: list-item; }
.bp__role--start .bp__role-name { font-weight: 600; }
.bp__role-name { font-weight: 600; }
.bp__projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
.bp__project { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; cursor: pointer; color: var(--ink); }
.bp__project--off { cursor: default; color: var(--ink-2); }
.bp__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bp__result { display: flex; flex-direction: column; gap: 8px; }
.bp__list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--ink-2); }
@media (max-width: 480px) {
    .bp__sizes { grid-template-columns: 1fr; }
    .bp__projects { grid-template-columns: 1fr; }
    .bp__actions .ah-btn { width: 100%; }
}
</style>
