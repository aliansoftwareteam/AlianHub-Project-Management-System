<template>
    <teleport to="body">
        <div v-if="isVisible && !aiOpen" class="ah-cp" role="dialog" aria-modal="true" :aria-label="$t('AuthV2.new_project')" @keydown.esc="close">
            <div class="ah-cp__backdrop" @click="!busy && close()"></div>
            <div class="ah-cp__modal">
                <aside class="ah-cp__left">
                    <div class="ah-cp__head">
                        <h2 class="ah-h1">{{ $t('AuthV2.new_project') }}</h2>
                        <input v-model.trim="search" type="search" class="ah-input ah-cp__search" :placeholder="$t('AuthV2.search_templates')" :aria-label="$t('AuthV2.search_templates')" />
                    </div>
                    <div class="ah-cp__filters">
                        <button v-if="teamFocus" type="button" class="ah-cp__filter" :class="{ 'is-on': filter === 'focus' }" @click="filter = 'focus'">{{ $t('AuthV2.for_focus', { focus: $t(`AuthV2.focus_${teamFocus}`) }) }}</button>
                        <button type="button" class="ah-cp__filter" :class="{ 'is-on': filter === 'all' }" @click="filter = 'all'">{{ $t('AuthV2.all') }}</button>
                    </div>
                    <div class="ah-cp__list ah-scroll">
                        <button type="button" class="ah-cp__tpl" :class="{ 'is-on': selected._id === blank._id }" @click="select(blank)">
                            <span class="ah-cp__tpl-icon"><ShellIcon name="plus" :size="15" /></span>
                            <span><span class="ah-cp__tpl-name">{{ blank.TemplateName }}</span><span class="ah-cp__tpl-desc">{{ blank.Description }}</span></span>
                        </button>
                        <div v-if="loading" class="ah-cp__spin"><SpinnerComp :is-spinner="true" /></div>
                        <template v-else>
                            <button v-for="tpl in shownGlobal" :key="tpl._id" type="button" class="ah-cp__tpl" :class="{ 'is-on': selected._id === tpl._id }" @click="select(tpl)">
                                <span class="ah-cp__tpl-icon" :class="`ah-cp__tpl-icon--${templateGlyph(tpl).tone}`"><ShellIcon :name="templateGlyph(tpl).icon" :size="15" /></span>
                                <span>
                                    <span class="ah-cp__tpl-name">{{ tpl.TemplateName }}</span>
                                    <span class="ah-cp__tpl-desc">{{ shortDescription(tpl) }} {{ $t('AuthV2.template_meta', { statuses: tpl.taskStatusData?.length || 0, tasks: tpl.sampleTaskCount || 0 }) }}</span>
                                </span>
                            </button>
                            <template v-if="shownCustom.length">
                                <div class="ah-label ah-cp__group">{{ $t('AuthV2.workspace_templates', { company: companyName }) }}</div>
                                <button v-for="tpl in shownCustom" :key="tpl._id" type="button" class="ah-cp__tpl" :class="{ 'is-on': selected._id === tpl._id }" @click="select(tpl)">
                                    <span class="ah-cp__tpl-icon ah-cp__tpl-icon--brand"><ShellIcon name="star" :size="15" /></span>
                                    <span>
                                        <span class="ah-cp__tpl-name">{{ tpl.TemplateName }}</span>
                                        <span class="ah-cp__tpl-desc">{{ shortDescription(tpl) }} {{ $t('AuthV2.template_meta', { statuses: tpl.taskStatusData?.length || 0, tasks: 0 }) }}</span>
                                    </span>
                                </button>
                            </template>
                            <div v-if="search && !shownGlobal.length && !shownCustom.length" class="ah-cp__empty">{{ $t('AuthV2.no_templates_match') }}</div>
                        </template>
                        <button type="button" class="ah-cp__tpl" @click="aiOpen = true">
                            <span class="ah-cp__tpl-icon ah-cp__tpl-icon--agent"><ShellIcon name="ai" :size="15" /></span>
                            <span><span class="ah-cp__tpl-name">{{ $t('AuthV2.from_description') }}</span><span class="ah-cp__tpl-desc">{{ $t('AuthV2.from_description_desc') }}</span></span>
                        </button>
                    </div>
                </aside>

                <section class="ah-cp__right ah-scroll">
                    <div>
                        <div class="ah-label">{{ $t('AuthV2.preview', { name: selected.TemplateName }) }}</div>
                        <div class="ah-cp__statuses">
                            <span v-for="(s, i) in selected.taskStatusData || []" :key="s.key || s.name" class="ah-cp__status" :class="`ah-cp__status--${statusTone(s, i)}`">{{ s.name }}</span>
                        </div>
                    </div>

                    <div class="ah-card ah-cp__sample">
                        <template v-if="sampleCount">
                            <div class="ah-label">{{ $t('AuthV2.sample_tasks_label', { n: sampleCount }) }}</div>
                            <div v-for="name in (selected.sampleTaskNames || []).slice(0, 3)" :key="name" class="ah-cp__sample-row"><span class="ah-cp__box"></span>{{ name }}<span class="ah-mono">1h</span></div>
                            <div v-if="sampleCount > 3" class="ah-cp__sample-row ah-cp__sample-row--more"><span class="ah-cp__box"></span>{{ $t('AuthV2.more_tasks', { n: sampleCount - 3 }) }}</div>
                        </template>
                        <div v-else class="ah-cp__sample-row ah-cp__sample-row--more">{{ $t('AuthV2.no_sample') }}</div>
                    </div>

                    <form class="ah-cp__form" novalidate @submit.prevent="submit">
                        <div v-if="banner" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ banner }}</div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="cp-name">{{ $t('AuthV2.project_name') }}</label>
                            <input
                                id="cp-name"
                                ref="nameInput"
                                v-model.trim="form.name"
                                type="text"
                                class="ah-input ah-input--name"
                                :class="{ 'ah-input--error': errors.name }"
                                maxlength="100"
                                autocomplete="off"
                                :placeholder="$t('PlaceHolder.Enter_Project_Name')"
                                @input="onNameInput"
                            />
                            <div v-if="errors.name" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.name }}</div>
                        </div>
                        <div class="ah-cp__row">
                            <div class="ah-field">
                                <label class="ah-field__label" for="cp-key">{{ $t('AuthV2.project_key') }}</label>
                                <input id="cp-key" v-model.trim="form.key" type="text" class="ah-input ah-mono" :class="{ 'ah-input--error': errors.key }" maxlength="10" autocomplete="off" @input="onKeyInput" />
                                <div v-if="errors.key" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.key }}</div>
                            </div>
                            <div class="ah-field">
                                <label class="ah-field__label" for="cp-visibility">{{ $t('AuthV2.visibility') }}</label>
                                <select id="cp-visibility" v-model="form.isPrivate" class="ah-input ah-cp__select">
                                    <option :value="false">{{ $t('AuthV2.everyone_in', { company: companyName }) }}</option>
                                    <option :value="true">{{ $t('AuthV2.private_project') }}</option>
                                </select>
                            </div>
                        </div>
                        <div class="ah-cp__row">
                            <div class="ah-field">
                                <label class="ah-field__label">{{ $t('ProjectDetails.source') }}</label>
                                <ProjectSourceSelect v-model="form.source" @changed="errors.source = ''; errors.proposalId = ''" />
                                <div v-if="errors.source" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.source }}</div>
                            </div>
                            <div v-if="isUpwork(form.source)" class="ah-field">
                                <label class="ah-field__label" for="cp-proposal">{{ $t('ProjectDetails.proposal_id') }}</label>
                                <input id="cp-proposal" v-model.trim="form.proposalId" type="text" class="ah-input" :class="{ 'ah-input--error': errors.proposalId }" maxlength="100" :placeholder="$t('PlaceHolder.Enter_Proposal_Id')" @input="errors.proposalId = ''" />
                                <div v-if="errors.proposalId" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.proposalId }}</div>
                                <div v-else class="ah-field__hint">{{ $t('Projects.proposal_id_format_hint') }}</div>
                            </div>
                            <div v-else class="ah-field">
                                <label class="ah-field__label">{{ $t('AuthV2.due_date') }}</label>
                                <VueDatePicker v-model="form.dueDate" :placeholder="$t('PlaceHolder.Select_Project_Due_Date')" auto-apply :close-on-auto-apply="true" :min-date="new Date()" :enable-time-picker="false" />
                            </div>
                        </div>
                        <div class="ah-cp__row">
                            <div class="ah-field">
                                <label class="ah-field__label">{{ $t('AuthV2.lead') }}</label>
                                <div class="ah-cp__lead">
                                    <Assignee :users="form.leads.map((x) => x.id)" :options="users.map((x) => x._id)" :num-of-users="3" imageWidth="30px" :isDisplayTeam="false" @selected="updateLead($event, 'add')" @removed="updateLead($event, 'remove')" />
                                </div>
                            </div>
                            <div class="ah-field">
                                <label class="ah-field__label">{{ $t('ProjectDetails.skills') }}</label>
                                <SkillsSelect v-model="form.skills" :bordered="true" :showAll="true" />
                            </div>
                        </div>
                        <div v-if="isUpwork(form.source)" class="ah-field">
                            <label class="ah-field__label">{{ $t('AuthV2.due_date') }}</label>
                            <VueDatePicker v-model="form.dueDate" :placeholder="$t('PlaceHolder.Select_Project_Due_Date')" auto-apply :close-on-auto-apply="true" :min-date="new Date()" :enable-time-picker="false" />
                        </div>
                        <label v-if="sampleCount" class="ah-cp__check">
                            <input v-model="form.includeSamples" type="checkbox" class="ah-check" />
                            <span>{{ $t('AuthV2.include_samples', { n: sampleCount }) }} <span class="ah-muted">{{ $t('AuthV2.include_samples_hint') }}</span></span>
                        </label>
                        <div class="ah-cp__foot">
                            <button type="button" class="ah-btn ah-btn--secondary" :disabled="busy" @click="close">{{ $t('Projects.cancel') }}</button>
                            <button type="submit" class="ah-btn ah-btn--primary" :disabled="busy" id="createprojectbtn_driver">
                                <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('AuthV2.creating_project') : $t('AuthV2.create_project') }}
                            </button>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    </teleport>
    <AiProjectCreator v-if="aiOpen" :visible="aiOpen" @close="aiOpen = false" @created="onAiCreated" />
</template>

<script setup>
import { computed, inject, nextTick, onMounted, reactive, ref, watch } from "vue";

defineOptions({ name: "CreateProjectSidebar" });
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import VueDatePicker from "@vuepic/vue-datepicker";
import "@vuepic/vue-datepicker/dist/main.css";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import SkillsSelect from "@/components/molecules/SkillsSelect/SkillsSelect.vue";
import ProjectSourceSelect from "@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue";
import AiProjectCreator from "@/components/organisms/AiProjectCreator/AiProjectCreator.vue";
import { useGetterFunctions } from "@/composable";
import { dbCollections } from "@/utils/Collections";
import { isUpwork, checkProposalId, PROJECT_SOURCES, DEFAULT_SOURCE } from "@/utils/projectSource";
import * as helper from "@/components/templates/CreateProject/helper.js";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { blankTemplate, templateGlyph, colorForName, keyFromName, statusTone } from "./templates";

const props = defineProps({
    isActiveCreateSidebar: { type: Boolean, default: false },
    isAdvanceFilterApplied: { type: Boolean, default: false }
});
const emit = defineEmits(["update:visible", "click:closeSidebar", "closeSidebar", "update:manageTempList", "useTemplate", "update-processing"]);

const { t } = useI18n();
const $toast = useToast();
const route = useRoute();
const router = useRouter();
const { getters, dispatch, commit } = useStore();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");
const companyId = inject("$companyId");

const isVisible = ref(props.isActiveCreateSidebar);
watch(() => props.isActiveCreateSidebar, (v) => { isVisible.value = v; });

const currentCompany = computed(() => getters["settings/selectedCompany"] || {});
const companyName = computed(() => currentCompany.value.Cst_CompanyName || "");
const teamFocus = computed(() => currentCompany.value.teamFocus || "");
const users = computed(() => getters["users/users"] || []);
const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
const defaultCurrency = computed(() => getters["settings/allCurrencyArray"]?.find((x) => x.code === "INR") || {});
const existingKeys = computed(() => (getters["projectData/allProjects"]?.data || []).map((p) => String(p.ProjectCode || "").toUpperCase()));

const blank = blankTemplate(t);
const globalTemplates = ref([]);
const customTemplates = ref([]);
const loading = ref(false);
const search = ref("");
const filter = ref(teamFocus.value ? "focus" : "all");
const selected = ref(blank);
const aiOpen = ref(false);
const busy = ref(false);
const banner = ref("");
const nameInput = ref(null);

const form = reactive({ name: "", key: "", keyTouched: false, isPrivate: false, source: DEFAULT_SOURCE, proposalId: "", dueDate: "", leads: [], skills: [], includeSamples: true });
const errors = reactive({ name: "", key: "", source: "", proposalId: "" });

const matches = (tpl) => {
    const q = search.value.toLowerCase();
    return !q || `${tpl.TemplateName} ${tpl.Description || ""}`.toLowerCase().includes(q);
};
const shownGlobal = computed(() => globalTemplates.value.filter((tpl) => matches(tpl) && (filter.value !== "focus" || tpl.focus === teamFocus.value)));
const shownCustom = computed(() => customTemplates.value.filter(matches));
const sampleCount = computed(() => Number(selected.value.sampleTaskCount) || 0);
const shortDescription = (tpl) => {
    const text = String(tpl.Description || "").replace(/\s+/g, " ").trim();
    return text.length > 90 ? `${text.slice(0, 87).trim()}…` : text;
};

onMounted(async () => {
    loading.value = true;
    try {
        const [globalRes] = await Promise.all([
            apiRequest("post", env.GLOBAL_PROJECT_TEMPLATE, { teamFocus: teamFocus.value }),
            dispatch("projectData/setprojectTemplate", companyId.value).catch(() => {})
        ]);
        if (globalRes.data.status) globalTemplates.value = (globalRes.data.statusText || []).map((tpl) => ({ ...tpl, useTemplateProj: "category" }));
        customTemplates.value = (getters["projectData/projectTemplate"]?.data || []).map((tpl) => ({ ...tpl, useTemplateProj: "withoutcategory", focus: "other" }));
        const first = shownGlobal.value[0];
        if (first) selected.value = first;
    } catch (error) {
        console.error("Error in getting projectTemplate", error);
    } finally {
        loading.value = false;
        nextTick(() => nameInput.value?.focus());
    }
});

const select = (tpl) => { selected.value = tpl; form.includeSamples = (Number(tpl.sampleTaskCount) || 0) > 0; };
const onNameInput = () => {
    errors.name = "";
    if (!form.keyTouched) { form.key = keyFromName(form.name); errors.key = ""; }
};
const onKeyInput = () => {
    form.keyTouched = form.key !== "";
    form.key = form.key.replace(/[^a-z0-9]/gi, "").toUpperCase();
    errors.key = "";
};
const updateLead = (member, type) => {
    if (type === "add") form.leads.push({ ...member });
    else form.leads = form.leads.filter((x) => x.id !== member.id);
};

const validate = () => {
    errors.name = !form.name ? t("AuthV2.project_name_required") : form.name.length < 3 ? t("AuthV2.project_name_short") : "";
    errors.key = !form.key ? t("AuthV2.key_required") : existingKeys.value.includes(form.key) ? t("AuthV2.key_taken") : "";
    errors.source = PROJECT_SOURCES.includes(form.source) ? "" : t("Projects.source_required");
    errors.proposalId = checkProposalId(form.source, form.proposalId) === "required" ? t("Projects.proposal_id_required_upwork") : "";
    return !errors.name && !errors.key && !errors.source && !errors.proposalId;
};

const close = () => {
    if (busy.value) return;
    isVisible.value = false;
    emit("closeSidebar", false);
    emit("click:closeSidebar", false);
};

const userData = () => {
    const user = getUser(userId.value, true) || {};
    return { id: user.id, Employee_Name: user.Employee_Name, companyid: user.AssignCompany, companyData: [], companyOwnerId: user.companyOwnerId };
};

const submit = async () => {
    if (!validate() || busy.value) return;
    busy.value = true;
    banner.value = "";
    try {
        const tpl = selected.value;
        const leadIds = form.leads.map((x) => x.id);
        const due = form.dueDate ? new Date(form.dueDate) : "";
        const getId = await apiRequest("get", env.GENERATEMONGOID);
        const docId = getId.status === 200 ? getId?.data || "" : "";
        if (!docId) throw new Error("no id");
        const payload = {
            _id: docId,
            AssigneeUserId: Array.from(new Set([companyUser.value.userId, ...leadIds].filter(Boolean))),
            ProjectName: form.name,
            CompanyId: companyId.value,
            ProjectCode: form.key,
            ProjectType: "Fix",
            LeadUserId: leadIds,
            markAsStar: false,
            sprintsObj: {},
            sprintsfolders: {},
            DueDate: due,
            ...(due && { dueDateDeadLine: [{ date: due }] }),
            proposalId: form.proposalId,
            skills: form.skills,
            source: form.source,
            projectIcon: { type: "color", data: colorForName(form.name) },
            TemplateName: tpl._id === blank._id ? "" : tpl.TemplateName,
            TemplateId: tpl._id,
            isPrivateSpace: form.isPrivate,
            TaskTypeTemplateId: "",
            statusType: "active",
            lastTaskId: 0,
            ProjectRequiredDefaultComponent: (tpl.TemplateRequiredComponent || []).find((x) => x.setAsDefault)?.keyName || "ProjectListView",
            ProjectCurrency: defaultCurrency.value,
            useTemplateProj: tpl.useTemplateProj || "category",
            projectCreatedBy: userId.value,
            isGlobalPermission: true,
            customFiedlsValue: tpl.customFiedlsValue || [],
            includeSampleTasks: form.includeSamples && sampleCount.value > 0,
            sampleFocus: tpl.focus || ""
        };
        const path = `${companyId.value}/${companyId.value}/${dbCollections.PROJECTS}`;
        const result = await helper.HandleProject(path, payload, userData(), companyId.value, false);
        if (!result.status) { banner.value = t("AuthV2.project_failed"); return; }
        $toast.success(t("Toast.Project_data_has_been_added_successfully", {
            filterMessage: props.isAdvanceFilterApplied ? t("Toast.please_remove_the_advanced_filter_to_view_newly_created_projects") : ""
        }), { position: "top-right" });
        commit("projectData/mutateProjects", [{ snap: null, privateSnap: false, op: "added", data: { ...result.data, id: result.id } }]);
        (result.customFieldValueArray || []).forEach((field) => commit("settings/mutateFinalCustomFields", { data: field || {}, op: "added" }));
        close();
        if (!props.isAdvanceFilterApplied) {
            const tab = payload.ProjectRequiredDefaultComponent;
            setTimeout(() => router.replace({ name: "Project", params: { cid: route.params?.cid, id: result.id }, query: { ...route.query, tab } }), 100);
        }
    } catch (error) {
        console.error("ERROR in create project: ", error);
        banner.value = t("AuthV2.project_failed");
    } finally {
        busy.value = false;
    }
};

const onAiCreated = ({ projectId } = {}) => {
    aiOpen.value = false;
    close();
    if (projectId) router.replace({ name: "Project", params: { cid: route.params?.cid, id: projectId }, query: { ...route.query, tab: "ProjectListView" } });
};
</script>

<style>
@import "./style.css";
</style>
