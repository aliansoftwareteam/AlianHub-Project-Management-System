<template>
    <section class="ah-card bp" data-test="blueprint-picker">
        <div class="ah-card__body bp__body">
            <header class="bp__head">
                <h2 class="ah-h3 bp__title">{{ $t('CompanyBlueprint.title') }}</h2>
                <p class="ah-small bp__muted">{{ $t('CompanyBlueprint.lead') }}</p>
            </header>

            <p v-if="loading" class="ah-empty">{{ $t('CompanyBlueprint.loading') }}</p>
            <p v-else-if="loadError" class="ah-field__error" role="alert" data-test="bp-load-error">{{ loadError }}</p>
            <template v-else-if="industries.length">
                <p v-if="!dispatcherOn && showOffNote" class="ah-small bp__note" data-test="bp-off" role="status">{{ $t('TeamPacks.dispatcher_off') }}</p>

                <div class="bp__choose">
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
                </div>

                <div v-if="current" class="bp__plan" data-test="bp-plan">
                    <div class="bp__summary">
                        <p class="bp__line" data-test="bp-seats">{{ $t('CompanyBlueprint.counts', { roles: current.roles.length, from: current.seats[0], to: current.seats[1] }) }}</p>
                        <p class="ah-small bp__muted">{{ $t('CompanyBlueprint.seats_hint') }}</p>
                    </div>

                    <div class="bp__group">
                        <h3 class="ah-label">{{ $t('CompanyBlueprint.teams_title') }}</h3>
                        <div class="bp__chips" data-test="bp-teams">
                            <span v-for="team in current.teams" :key="team" class="ah-chip ah-chip--sm">{{ teamName(t, te, team) }}</span>
                        </div>
                    </div>

                    <div class="bp__group">
                        <h3 class="ah-label">{{ $t('CompanyBlueprint.roles_title') }}</h3>
                        <ol class="bp__roles">
                            <li v-for="(role, index) in current.roles" :key="role.name" class="bp__role" :class="{ 'bp__role--start': index < STARTER }" data-test="bp-role">
                                <span class="bp__role-index">{{ index + 1 }}</span>
                                <span class="bp__role-text">
                                    <span class="bp__role-name">{{ role.name }}</span>
                                    <span class="ah-small bp__muted">{{ teamName(t, te, role.team) }}<template v-if="!role.key"> · {{ $t('CompanyBlueprint.not_written') }}</template></span>
                                </span>
                                <span v-if="index < STARTER" class="ah-chip ah-chip--sm ah-chip--brand">{{ $t('CompanyBlueprint.starter') }}</span>
                            </li>
                        </ol>
                    </div>
                </div>

                <PackProjectPicker
                    v-model="projectIds"
                    :projects="projects"
                    :max="MAX_PROJECTS"
                    test-id="bp-project"
                    empty-test-id="bp-no-projects"
                    :empty-text="$t('CompanyBlueprint.no_projects')"
                />

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
                    <p v-if="undone && undoneFieldsKept" class="ah-small bp__muted" data-test="bp-fields-kept">{{ $t('TeamPacks.fields_kept') }}</p>
                    <button v-if="!undone && (addedCount || otherChanges)" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="bp-undo" :disabled="busy" @click="undo">
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
import PackProjectPicker from "./PackProjectPicker.vue";
import { applyStarterRoles, blueprintName, COMPANY_SIZES, fetchTeamPacks, fieldsKeptAfterUndo, packProjectLine, roleNamesOf, teamName, undoStarterRoles } from "@/utils/dispatcher";

defineOptions({ name: "BlueprintPicker" });

const props = defineProps({ teamPacks: { type: Object, default: null }, showOffNote: { type: Boolean, default: true } });
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
const undoneFieldsKept = ref(false);

/* The server checks every project again; this only keeps out of reach what it would refuse. */
const whyNot = (project) => {
    if (isOwnerOrAdmin(getters["settings/companyUserDetail"]?.roleType)) return "";
    if (project.isGlobalPermission === false) return "own_roles";
    return checkPermission(DETAILS, true) === true ? "" : "no_permission";
};
const projects = computed(() => (getters["projectData/projects"]?.data || [])
    .filter((p) => !p.deletedStatusKey && p.isPersonal !== true)
    .map((p) => ({ id: String(p._id), name: p.ProjectName, why: whyNot(p) })));
const current = computed(() => industries.value.find((one) => one.id === industryId.value)?.sizes[size.value] || null);
const peopleOf = (one) => industries.value.find((it) => it.id === industryId.value)?.sizes[one]?.people || [0, 0];
const groups = computed(() => current.value?.packs || []);
const startCount = computed(() => groups.value.reduce((sum, group) => sum + group.roles.length, 0));
const resultProjects = computed(() => (results.value || []).flatMap((one) => one.projects));
const addedCount = computed(() => resultProjects.value.reduce((sum, project) => sum + (project.added || []).length, 0));
const otherChanges = computed(() => resultProjects.value.some((project) => (project.rules || []).length || (project.tags || []).length || (project.fields || []).length || project.modeWas));
const projectName = (id) => (projects.value.find((p) => p.id === String(id)) || {}).name || id;

const resultHead = computed(() => {
    if (undone.value) return t("TeamPacks.undone");
    if (addedCount.value) return t("TeamPacks.applied", { n: addedCount.value }, addedCount.value);
    return otherChanges.value ? t("TeamPacks.roles_were_on") : t("TeamPacks.nothing_new");
});

const roleName = computed(() => roleNamesOf(current.value?.roles));
const projectLine = (project) => packProjectLine(t, project, projectName(project.projectId), roleName.value);

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
        undoneFieldsKept.value = fieldsKeptAfterUndo(await undoStarterRoles(results.value));
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
.bp { margin-bottom: 16px; }
.bp__body { display: flex; flex-direction: column; gap: 18px; }
.bp__head { display: flex; flex-direction: column; gap: 4px; padding-bottom: 14px; border-bottom: 1px solid var(--hairline); }
.bp__title { margin: 0; }
.bp__muted { color: var(--ink-2); }
.bp__note { margin: 0; padding: 10px 12px; border: 1px solid var(--warn); border-radius: var(--r-card); background: var(--warn-bg); color: var(--warn-ink); }
.bp__choose { display: grid; grid-template-columns: minmax(200px, 280px) 1fr; gap: 16px; align-items: start; }
.bp__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.bp__set { margin: 0; padding: 0; border: 0; }
.bp__sizes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.bp__size { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface); color: var(--ink); cursor: pointer; min-width: 0; transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease); }
.bp__size:hover { border-color: var(--brand-border); }
.bp__size--on { border-color: var(--brand); background: var(--brand-tint); box-shadow: 0 0 0 1px var(--brand) inset; }
.bp__size-name { font-weight: 600; }
.bp__size:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
.bp__radio { position: absolute; opacity: 0; pointer-events: none; }
.bp__plan { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; border-radius: var(--r-card); background: var(--surface-2); }
.bp__summary { display: flex; flex-direction: column; gap: 2px; }
.bp__group { display: flex; flex-direction: column; gap: 8px; }
.bp__group .ah-label { margin: 0; }
.bp__line { margin: 0; font-weight: 600; color: var(--ink); }
.bp__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bp__roles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px; }
.bp__role { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-sm); background: var(--surface); color: var(--ink); min-width: 0; }
.bp__role--start { border-color: var(--brand-border); }
.bp__role-index { flex: none; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: var(--fill); color: var(--ink-2); font: var(--text-data); }
.bp__role--start .bp__role-index { background: var(--brand); color: var(--on-brand); }
.bp__role-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.bp__role-name { font-weight: 600; overflow-wrap: anywhere; }
.bp__actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding-top: 14px; border-top: 1px solid var(--hairline); }
.bp__result { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: var(--r-card); background: var(--ok-bg); }
.bp__list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--ink-2); }
@media (max-width: 720px) {
    .bp__choose { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
    .bp__sizes { grid-template-columns: 1fr; }
    .bp__actions .ah-btn { width: 100%; }
}
</style>
