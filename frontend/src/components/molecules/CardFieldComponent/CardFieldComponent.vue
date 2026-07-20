<template>
    <div class="custom-form" ref="formRef">
        <div class="p-20px pt-0 pb-0 custom-form-container" v-if="Object.keys(formObj).length && fieldArray.length">
            <div class="mb-2" v-if="hasGroup('display')">
                <h3 class="group_by_card">{{$t('dashboardCard.display')}}</h3>
                <template v-for="(field, index) in fieldArray.filter(e => e.groupBy === 'display')" :key="index">
                    <TextInputFieldComponent
                        v-if="field?.type === 'text' && !field?.hidden" 
                        :field="field"
                        :index="index"
                        :formObj="formObj"
                        @update:form-obj="handleFormUpdate"
                        @check-errors="checkErrors"
                    />

                    <DropDownListComponent
                        v-else-if="field?.type === 'dropdown' && !field?.hidden && (field?.label === 'calculation' ? selectedMeasure === 1 || selectedMeasure === 2 : field?.label === 'timerange' ? selectedMeasure !== 3 : true)"
                        :id="makeUniqueId(6)"
                        :matchField="field?.label === 'status' ? 'key' : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'group_by' || field?.label === 'fields' ? 'id' || field?.label === 'logtype' : '_id'"
                        :items="field?.label === 'show_assignees' ? assigneeOptions : field?.label === 'location' ? allProjectsArray : field?.label === 'status' ? taskStatusArray : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? field?.options : []"
                        :selectedItems="field?.label === 'show_assignees' ? selectedUser : field?.label === 'location' ? selectedProjects : field?.label === 'status' ? selectedStatus : field?.label === 'measure' ? selectedMeasure : field?.label === 'calculation' ? selectedCalculation : field?.label === 'timerange' ? selectedTimeRange : field?.label === 'logtype' ? selectedLogtype : field?.label === 'group_by' ? selectedGroupBy : field?.label === 'fields' ? selectedFields : []"
                        :field="field"
                        :displayType="field?.label === 'show_assignees' ? 'profile' : field?.label === 'location' ? 'project' : field?.label === 'status' ? 'color' : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? 'text' : ''"
                        :is-multi-select="field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' ? false : true"
                        :searchKey="field?.label === 'show_assignees' ? 'Employee_Name' : field?.label === 'location' ? 'ProjectName' : field?.label === 'status' ? 'name' : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? 'name' : ''"
                        :getDisplayText="(item) => field?.label === 'location' ? `${props?.allProjectsArray?.find(e => e._id === item)?.ProjectName}` : field?.label === 'status' ? taskStatusArray?.find(e => e?.key === item)?.name : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' ? $t(`dashboardCard.${field?.options?.find(e => e?.id === item)?.name}`) : field?.label === 'fields' ? $t(`Header.${field?.options?.find(e => e?.id === item)?.name}`) : ''"
                        :getDisplayTextOption="(item) => field?.label === 'location' ? `${props?.allProjectsArray?.find(e => e._id === item?._id)?.ProjectName}` : field?.label === 'status' ? taskStatusArray?.find(e => e?.key === item?.key)?.name : field?.label === 'measure' || field?.label === 'calculation'  || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' ? $t(`dashboardCard.${field?.options?.find(e => e?.id === item?.id)?.name}`) : field?.label === 'fields' ? $t(`Header.${field?.options?.find(e => e?.id === item?.id)?.name}`) : ''"
                        :selectedItem="field?.label === 'measure' ? selectedMeasure : field?.label === 'calculation' ? selectedCalculation : field?.label === 'timerange' ? selectedTimeRange : field?.label === 'logtype' ? selectedLogtype : field?.label === 'group_by' ? selectedGroupBy : ''"
                        @update:selected="updateData"
                        :isMultiLanguage="field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? true : false"
                        :error="field?.label === 'show_assignees' ? error : field?.label === 'location' ? errorProject : ''"
                        :isCheckBox="field?.label === 'fields' ? true : false"
                    />
                    
                    <ToggleFieldComponent 
                        v-else-if="field?.type === 'radio' && !field?.hidden && (selectedMeasure === 3 || selectedMeasure === null)"
                        :field="field"
                        :formObj="formObj"
                        @update:form-obj="handleFormUpdate"
                        :index="index"
                    />
                </template>
            </div>
            <div class="mb-2" v-if="hasGroup('data')">
                <h3 class="group_by_card">{{$t('dashboardCard.data')}}</h3>
                <template v-for="(field, index) in fieldArray.filter(e => e.groupBy === 'data')" :key="index">
                    <TextInputFieldComponent 
                        v-if="field?.type === 'text' && !field?.hidden && (selectedMeasure === 3 || selectedMeasure === null)" 
                        :field="field"
                        :index="index"
                        :formObj="formObj"
                        @update:form-obj="handleFormUpdate"
                        @check-errors="checkErrors"
                    />

                    <DropDownListComponent
                        v-else-if="field?.type === 'dropdown' && !field?.hidden && ((field?.label === 'calculation' || field?.label === 'show_assignees' ) && selectedMeasure ? selectedMeasure === 1 || selectedMeasure === 2 : field?.label === 'timerange' ? selectedMeasure !== 3 : true)"
                        :id="makeUniqueId(6)"
                        :class="{ 'cf-disabled': field?.label === 'location' && allProjects }"
                        :matchField="field?.label === 'status' ? 'key' : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'group_by' || field?.label === 'fields' ? 'id' || field?.label === 'logtype' : '_id'"
                        :items="field?.label === 'show_assignees' ? assigneeOptions : field?.label === 'location' ? allProjectsArray : field?.label === 'status' ? taskStatusArray : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? field?.options : []"
                        :selectedItems="field?.label === 'show_assignees' ? selectedUser : field?.label === 'location' ? selectedProjects : field?.label === 'status' ? selectedStatus : field?.label === 'measure' ? selectedMeasure : field?.label === 'calculation' ? selectedCalculation : field?.label === 'timerange' ? selectedTimeRange : field?.label === 'logtype' ? selectedLogtype : field?.label === 'group_by' ? selectedGroupBy : field?.label === 'fields' ? selectedFields : []"
                        :field="field"
                        :displayType="field?.label === 'show_assignees' ? 'profile' : field?.label === 'location' ? 'project' : field?.label === 'status' ? 'color' : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? 'text' : ''"
                        :is-multi-select="field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' ? false : true"
                        :searchKey="field?.label === 'show_assignees' ? 'Employee_Name' : field?.label === 'location' ? 'ProjectName' : field?.label === 'status' ? 'name' : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? 'name' : ''"
                        :getDisplayText="(item) => field?.label === 'location' ? `${props?.allProjectsArray?.find(e => e._id === item)?.ProjectName}` : field?.label === 'status' ? taskStatusArray?.find(e => e?.key === item)?.name : field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' ? $t(`dashboardCard.${field?.options?.find(e => e?.id === item)?.name}`) : field?.label === 'fields' ? $t(`Header.${field?.options?.find(e => e?.id === item)?.name}`) : ''"
                        :getDisplayTextOption="(item) => field?.label === 'location' ? `${props?.allProjectsArray?.find(e => e._id === item?._id)?.ProjectName}` : field?.label === 'status' ? taskStatusArray?.find(e => e?.key === item?.key)?.name : field?.label === 'measure' || field?.label === 'calculation'  || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' ? $t(`dashboardCard.${field?.options?.find(e => e?.id === item?.id)?.name}`) : field?.label === 'fields' ? $t(`Header.${field?.options?.find(e => e?.id === item?.id)?.name}`) : ''"
                        :selectedItem="field?.label === 'measure' ? selectedMeasure : field?.label === 'calculation' ? selectedCalculation : field?.label === 'timerange' ? selectedTimeRange : field?.label === 'logtype' ? selectedLogtype : field?.label === 'group_by' ? selectedGroupBy : ''"
                        @update:selected="updateData"
                        :isMultiLanguage="field?.label === 'measure' || field?.label === 'calculation' || field?.label === 'timerange' || field?.label === 'logtype' || field?.label === 'group_by' || field?.label === 'fields' ? true : false"
                        :error="field?.label === 'show_assignees' ? error : field?.label === 'location' ? errorProject : ''"
                        :isCheckBox="field?.label === 'fields' ? true : false"
                    />

                    <ToggleFieldComponent
                        v-else-if="field?.type === 'radio' && !field?.hidden && (selectedMeasure === 3 || selectedMeasure === null)"
                        :field="field"
                        :formObj="formObj"
                        @update:form-obj="handleFormUpdate"
                        :index="index"
                    />

                    <!-- All-projects toggle: ON scopes to every accessible project
                         (persisted as [] = dynamic), so newly assigned projects are
                         auto-included; OFF keeps the picker editable. Aligned under
                         the field column to read as part of the Project field. -->
                    <div
                        v-if="field?.label === 'location' && !field?.hidden"
                        class="cf-all-projects-row"
                    >
                        <span class="cf-all-projects-spacer"></span>
                        <label class="cf-toggle">
                            <input
                                type="checkbox"
                                :checked="allProjects"
                                @change="onAllProjectsToggle($event.target.checked)"
                            />
                            <span>{{ $t('CustomReport.all_projects') }}</span>
                        </label>
                    </div>

                    <!-- Recently Added Projects — quick-review list of projects
                         created in the last ~2 days (same rule as the project
                         sidebar's green "new" marker). Ticking a row adds it to
                         the Project selection above. Employee Workload card only;
                         purely additive — it just toggles selectedProjects. -->
                    <RecentlyAddedProjects
                        v-if="componentId === 'EmployeeWorkloadReportCard' && field?.label === 'location' && !field?.hidden && newlyAddedProjects.length"
                        :projects="newlyAddedProjects"
                        :selectedIds="selectedProjects"
                        @toggle="toggleNewProject"
                        @dismiss="dismissNewProject"
                    />
                </template>
                <!-- Work-by-Category card: category → task-type template editor.
                     Writes the map into the form object so it saves through the
                     standard card-config submit path (no separate modal). -->
                <CategoryTaskTypeMapper
                    v-if="componentId === 'UsersByCategoryCard' && formObj.categoryMap"
                    :modelValue="formObj.categoryMap.value || {}"
                    @update:modelValue="updateCategoryMap"
                />
            </div>
            <div v-if="cardType !== 'time_tracking' && componentId !== 'QueueListComp' && componentId !== 'EmployeeWorkloadReportCard' && fieldArray.some(e => e.groupBy === 'filter')">
                <div class="custom-field card-advanced-filter">
                    <h3 class="group_by_card">{{$t('Filters.filter')}}</h3>
                    <template v-for="(field, index) in fieldArray.filter(e => e.groupBy === 'filter')" :key="index">
                        <HomeTaskFilter 
                            class="custom-field" 
                            :selectedProjects="filteredProjects?.filter(project =>selectedProjects.includes(project._id)) ?? []" 
                            @selectedFilter="(e) => taskFilter = e" 
                            :selected="taskFilter" 
                            :isValidateFilter="isValidateFilter"
                            :filterField="selectedMeasure && (selectedMeasure === 1 || selectedMeasure === 2) ? ['AssigneeUserId'] : []"
                            v-if="field.label === 'add_filter'" />
                    </template>
                </div>
            </div>
        </div>

        <div class="card-component-btn">
            <button type="button" @click="handleTabCheck" class="cancel-btn">{{ $t('Projects.cancel') }}</button>
            <button type="submit" @click="handleSubmit" :disabled="submitted" class="submit-btn">{{ $t('Projects.save') }}</button>
        </div>
    </div>
</template>

<script setup>
import {inject} from 'vue';
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useCustomComposable } from '@/composable';
import { useValidation } from "@/composable/Validation.js";
import { onMounted, ref,computed, watch, onUnmounted } from "vue";
import DropDownListComponent from "@/components/templates/Dashboard/DropDownListComponent.vue";
import ToggleFieldComponent from "@/components/templates/Dashboard/ToggleFieldComponent.vue";
import TextInputFieldComponent from "@/components/templates/Dashboard/TextInputFieldComponent.vue";
import HomeTaskFilter from '@/components/molecules/TaskFilter/HomeTaskFilter.vue'
import RecentlyAddedProjects from '@/components/molecules/RecentlyAddedProjects/RecentlyAddedProjects.vue';
import CategoryTaskTypeMapper from '@/components/molecules/CategoryTaskTypeMapper/CategoryTaskTypeMapper.vue';

const { t } = useI18n();
const store = useStore();
const { getters } = store;
const {makeUniqueId,checkPermission} = useCustomComposable()
const userId = inject("$userId");
const teams = computed(() => {
    // Members (roleType !== 1 and !== 2) cannot select teams in the
    // EmployeeWorkloadReportCard — the backend would only return their
    // own data anyway, so showing the full team list is misleading.
    if (props.componentId === 'EmployeeWorkloadReportCard') {
        const roleType = getters["settings/companyUserDetail"]?.roleType;
        if (roleType !== 1 && roleType !== 2) return [];
    }
    const teamsArr = getters["settings/teams"] || [];
    return teamsArr
        // Skip teams that have no members — selecting them does nothing.
        .filter((x) => Array.isArray(x.assigneeUsersArray) && x.assigneeUsersArray.length)
        .map((x) => {
            return {
                ...x,
                "_id": "tId_"+x._id,
                "Employee_Name": x.name,
                "Employee_profileImageURL": ""
            }
        })
});

const taskStatusArray = computed(() => JSON.parse(JSON.stringify(getters["settings/AllTaskStatus"]?.settings || [])));

const selectedUser = ref([]);
const selectedStatus = ref([]);
const selectedProjects = ref([]);
const filteredProjects = ref([]);
// "All projects" toggle. When ON the card scopes to every project the caller can
// access (persisted as an empty projectId), so newly assigned projects are
// auto-included; OFF requires an explicit selection.
const allProjects = ref(false);
const selectedFields = ref([]);
const taskFilter = ref([]);
const selectedMeasure = ref(null);
const selectedCalculation = ref(null);
const selectedTimeRange = ref(null);
const selectedGroupBy = ref(null);
const selectedLogtype = ref(null);
const isValidateFilter = ref(true);

//props
const props = defineProps({
    fieldsArray: {
        type: Array,
        default: () => [],
        required: true
    },
    allProjectsArray: {
        type: Array,
        default: () => [],
        required: true
    },
    isEditCard: {
        type: Boolean,
        default: false,
        required: true
    },
    cardType: {
        type: String,
        default: 'dashboard',
        required: true
    },
    componentId: {
        type: String,
        default: '',
    }
});
const usersArray = computed(() => {
    let lableAray = props.fieldsArray.map(field => field.label);
    const timeRange = lableAray.includes("timerange");
    const measure = selectedMeasure.value;
    const allUsers = JSON.parse(JSON.stringify(getters["users/users"]))
    const currentUserOnly = allUsers.filter(user => user._id === userId.value);

    // EmployeeWorkloadReportCard: show only users the viewer is
    // allowed to see — mirrors the backend role-based visibility.
    //   roleType 1 (Admin)   → all users
    //   roleType 2 (Manager) → all users (backend will further restrict)
    //   else   (Member)      → only themselves
    if (props.componentId === 'EmployeeWorkloadReportCard') {
        const roleType = getters["settings/companyUserDetail"]?.roleType;
        if (roleType !== 1 && roleType !== 2) {
            selectedUser.value = [userId.value]; // eslint-disable-line
            return currentUserOnly;
        }
        return allUsers;
    }

    const makeFilterCond = (key) => {
        const permission = checkPermission(key);
        if (permission === 2 || permission === true) return allUsers;
        if (permission === 1) {
            selectedUser.value = [userId.value]; // eslint-disable-line
            return currentUserOnly;
        }
        return currentUserOnly;
    };

    if (!timeRange) return allUsers;
    if (measure === 1) {
        return makeFilterCond('sheet_settings.workload_timesheet');
    } else if (measure === 2) {
        return makeFilterCond('sheet_settings.tracker_timesheet');
    } else {
        return allUsers;
    }
});

// "Me" quick-select for the assignee picker — prepends a self option that
// resolves to the viewer's own userId (their real id, so a saved/imported card
// still points at whoever configured it). The viewer's normal list entry is
// dropped to avoid a duplicate.
const assigneeOptions = computed(() => {
    const uid = userId && userId.value ? String(userId.value) : '';
    const base = [...teams.value, ...usersArray.value];
    if (!uid) return base;
    const withoutSelf = base.filter((u) => String(u._id) !== uid);
    return [{ _id: uid, Employee_Name: t('dashboardCard.me_option'), Employee_profileImageURL: '', isMe: true }, ...withoutSelf];
});

// ─── Recently Added Projects (Employee Workload card only) ──────────
// Mirrors the project sidebar's "new_project_add" rule (organisms/Item):
// a project is "newly added" when its createdAt is past midnight two days
// ago — the same threshold that paints the green left-border in the
// project list. We surface those under the Project dropdown so the user
// can tick recently-created projects straight into the card's selection.
const resolveCreatedMs = (createdAt) => {
    if (!createdAt) return NaN;
    if (typeof createdAt === 'object') {
        if (createdAt instanceof Date) return createdAt.getTime();
        const sec = createdAt.seconds ?? createdAt._seconds;
        if (sec != null) return Number(sec) * 1000;
        return new Date(createdAt).getTime();
    }
    return new Date(createdAt).getTime();
};
const isNewlyAddedProject = (project) => {
    const created = resolveCreatedMs(project?.createdAt);
    if (Number.isNaN(created)) return false;
    const now = new Date();
    const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).getTime();
    return created > threshold;
};
// Projects the user explicitly dismissed (the X on a suggestion row). Persisted
// in localStorage per user so a dismissed suggestion stays gone after the card
// is closed and reopened — even without saving. Only ids still inside the "new"
// window are retained (see dismissNewProject), so the stored list stays bounded.
const dismissKey = () => `rap_dismissed_${userId?.value || 'anon'}`;
const dismissedNewProjects = ref([]);
const loadDismissedProjects = () => {
    try {
        const raw = localStorage.getItem(dismissKey());
        dismissedNewProjects.value = raw ? (JSON.parse(raw) || []) : [];
    } catch (e) {
        dismissedNewProjects.value = [];
    }
};

const newlyAddedProjects = computed(() => {
    if (props.componentId !== 'EmployeeWorkloadReportCard') return [];
    return (props.allProjectsArray || [])
        .filter(isNewlyAddedProject)
        // Only surface projects NOT already on this card. Ticking one adds it
        // to selectedProjects (what Save persists), so it drops out of this
        // list immediately and won't be suggested again on reopen.
        .filter((p) => !selectedProjects.value.includes(p._id))
        // …and not ones the user dismissed with the X.
        .filter((p) => !dismissedNewProjects.value.includes(p._id))
        .sort((a, b) => resolveCreatedMs(b?.createdAt) - resolveCreatedMs(a?.createdAt));
});
// When "All projects" is turned on we ignore the picker and clear the required-
// selection error; the value is persisted as an empty projectId (= all
// accessible, dynamic) in the submit handler.
const onAllProjectsToggle = (val) => {
    allProjects.value = !!val;
    if (allProjects.value) {
        errorProject.value = '';
        // Keep the underlying selection populated (all accessible) so required-
        // location validation passes; Save collapses it to [] (dynamic all).
        selectedProjects.value = (props.allProjectsArray || []).map((e) => e._id);
        filteredProjects.value = [...(props.allProjectsArray || [])];
    }
};

// Toggle a project in/out of the SAME selectedProjects array the Project
// dropdown drives, so Save persists it through the existing path untouched.
const toggleNewProject = (projectId) => {
    if (!projectId) return;
    selectedProjects.value = selectedProjects.value.includes(projectId)
        ? selectedProjects.value.filter((id) => id !== projectId)
        : [...selectedProjects.value, projectId];
};
// Dismiss a suggestion (the X). Persist immediately so it survives the card
// being closed and reopened, pruning to ids still in the "new" window to keep
// the stored list bounded. Does NOT touch selectedProjects — only hides it.
const dismissNewProject = (projectId) => {
    if (!projectId) return;
    const candidateIds = (props.allProjectsArray || [])
        .filter(isNewlyAddedProject)
        .map((p) => p._id);
    const next = new Set(
        dismissedNewProjects.value.filter((id) => candidateIds.includes(id))
    );
    next.add(projectId);
    dismissedNewProjects.value = [...next];
    try {
        localStorage.setItem(dismissKey(), JSON.stringify(dismissedNewProjects.value));
    } catch (e) {
        // localStorage unavailable (private mode / quota) — the dismissal still
        // applies for this session via the reactive ref above.
    }
};

const error = ref('');
const formObj = ref({});
const formRef = ref(null);
const errorProject = ref('');
const submitted = ref(false);
// Drop the deprecated `hideEmptyEmployees` field from any card whose
// saved config still carries it (added to the dashboard before the
// field was removed). Empty users are always hidden now — no toggle.
const fieldArray = ref(
    JSON.parse(JSON.stringify(props.fieldsArray))
        .filter((f) => f && f.name !== 'hideEmptyEmployees')
);

// Whether a group (display/data) has any visible field — used to hide an
// empty section heading (e.g. a card with no Data fields).
const hasGroup = (g) => fieldArray.value.some((e) => e && e.groupBy === g && !e.hidden);

const { checkErrors, checkAllFields } = useValidation();

watch(()=>selectedUser.value, (newValue) => {
    if (newValue.length) error.value = "";
},{deep:true,immediate: true});

watch(()=>selectedProjects.value, (newValue) => {
    if (newValue.length) errorProject.value = "";
},{deep:true,immediate: true});

onMounted(() =>{
    loadDismissedProjects();
    initializeFormObject();
});

onUnmounted(() => {
    resetForm();
});

// Methods
const initializeFormObject = () => {
    for (const item of fieldArray.value) {
        formObj.value[item.name] = {
            value: item.value,
            rules: item.rules,
            name: item.label,
            error: "",
            placeHolder: item.placeHolder,
            hidden: item.hidden,
            disabled: item.disabled,
            options: item.options
        };
    }
    
    initializeSelectedValues();
};

const initializeSelectedValues = () => {
    if (formObj.value?.projectId) {
        const savedIds = formObj.value?.projectId?.value || [];
        // Empty saved projectId = "all accessible" (dynamic). New cards default to all.
        allProjects.value = props.isEditCard ? savedIds.length === 0 : true;
        selectedProjects.value = savedIds.length
            ? savedIds
            : (props.allProjectsArray?.map(e => e._id) || []);
        filteredProjects.value = props.allProjectsArray.filter(project =>
            selectedProjects.value.includes(project._id));
    } else if (fieldArray.value?.some(e => e.groupBy === 'filter')) {
        // Self-scoped cards (My Achievements, Due Soon, …) have no project picker,
        // but their filter's value lists (status/priority/…) are derived from the
        // projects' taskStatusData. Fall back to all projects so those render.
        selectedProjects.value = props.allProjectsArray?.map(e => e._id) || [];
        filteredProjects.value = props.allProjectsArray || [];
    }

    if (formObj.value?.AssigneeUserId) {
        selectedUser.value = props.isEditCard 
            ? (formObj.value?.AssigneeUserId?.value?.length ? formObj.value?.AssigneeUserId?.value : (usersArray.value?.map(e => e._id) || [])) 
            : (usersArray.value?.map(e => e._id) || []);
        if(formObj.value?.measure?.value !== null) {
            if(formObj.value?.measure?.value === 1) {
                if(checkPermission('sheet_settings.workload_timesheet') === 1) {
                    selectedUser.value = selectedUser.value?.filter((e)=>e == userId.value);
                } else if(checkPermission('sheet_settings.workload_timesheet') === null) {
                    selectedUser.value = [userId.value];
                }
            } else if(formObj.value?.measure?.value === 2) {
                if(checkPermission('sheet_settings.tracker_timesheet') === 1) {
                    selectedUser.value = selectedUser.value?.filter((e)=>e == userId.value);
                } else if(checkPermission('sheet_settings.workload_timesheet') === null) {
                    selectedUser.value = [userId.value];
                }
            }
        }
    }

    if (formObj.value?.statusArray) {
        selectedStatus.value = props.isEditCard 
            ? (formObj.value?.statusArray?.value?.length ? formObj.value?.statusArray?.value : (taskStatusArray.value?.map(e => e.key) || []))
            : (taskStatusArray.value?.map(e => e.key) || []);
    }
    if (formObj.value?.measure) {
        selectedMeasure.value = formObj.value?.measure?.value;
    }
    if (formObj.value?.calculation) {
        selectedCalculation.value = formObj.value?.calculation?.value;
    }
    if (formObj.value?.timerange) { 
        selectedTimeRange.value = formObj.value?.timerange?.value;
    }
    if (formObj.value?.fields) { 
        selectedFields.value = props.isEditCard ? (formObj.value?.fields?.value || []) :  (formObj.value?.fields?.options?.map((x) => x.id) || []);
    }
    if (formObj.value?.logtype) { 
        selectedLogtype.value = formObj.value?.logtype?.value;
    }
    if(formObj.value?.filter){
       taskFilter.value=formObj.value?.filter?.value || [];
    }
    if(formObj.value?.groupBy){
        // groupBy may arrive as a stale Mongo extended-JSON object ({ $numberLong: "0" });
        // normalize to the plain number so the option lookup matches (else the label
        // renders as "dashboardCard.undefined"). Strings/numbers pass through unchanged.
        const g = formObj.value?.groupBy?.value;
        selectedGroupBy.value = (g && typeof g === 'object' && g.$numberLong !== undefined) ? Number(g.$numberLong) : g;
    }
};

const resetForm = () => {
    formObj.value = {};
    submitted.value = false;
    selectedUser.value = [];
    selectedProjects.value = [];
    selectedStatus.value = [];
    selectedMeasure.value = null;
    selectedCalculation.value = null;
    selectedTimeRange.value = null;
    selectedLogtype.value = null;
    selectedGroupBy.value = null;
    filteredProjects.value = [];
    selectedFields.value = [];
};

//emit
const emit = defineEmits(['handleFunction', 'closeSidebar']);

// Form submission
const handleSubmit = async () => {
    error.value = "";
    errorProject.value = "";
    // Keep the projectId field value populated so a required-location rule
    // validates; the persisted value is decided below (empty = all when toggled).
    if (formObj.value?.projectId) {
        formObj.value.projectId.value = allProjects.value
            ? (props.allProjectsArray?.map(e => e._id) || [])
            : selectedProjects.value;
    }

    const filteredData = Object.fromEntries(
        // eslint-disable-next-line
        Object.entries(formObj.value).filter(([_, field]) => !field.hidden)
    );

    if (formObj.value?.AssigneeUserId && !selectedUser.value.length) {
        error.value = t(`dashboardCard.error_assignees`);
    }
    
    if (formObj.value?.projectId && !allProjects.value && !selectedProjects.value.length) {
        errorProject.value = t(`dashboardCard.error_location`);
    }
    const valid = await checkAllFields(filteredData);

    if (!valid || errorProject.value || error.value) {
        return;
    }

    const isValidFilter = validateItems(taskFilter.value);
    if(!isValidFilter){
        isValidateFilter.value = isValidFilter;
        return;
    }
    else{
       isValidateFilter.value = true; 
    }

    const emitData = Object.fromEntries(
        // eslint-disable-next-line
        Object.entries(formObj.value).filter(([_, field]) => !field.disabled).map(([key, field]) => [key, field.value])
    );

    taskFilter.value.forEach((item) => {
        delete item.isValidate;
    });

    // Override specific values
    if (formObj.value.AssigneeUserId) emitData.AssigneeUserId = selectedUser.value;
    // "All projects" ON → persist [] (= "all accessible", dynamic) so future
    // projects are auto-included; OFF persists the explicit selection.
    if (formObj.value.projectId) emitData.projectId = allProjects.value ? [] : selectedProjects.value;
    if (formObj.value.statusArray) emitData.statusArray = selectedStatus.value;
    if (formObj.value.measure) emitData.measure = selectedMeasure.value;
    if (formObj.value.calculation) emitData.calculation = selectedCalculation.value;
    if (formObj.value.timerange) emitData.timerange = selectedTimeRange.value;
    if (formObj.value.fields) emitData.fields = selectedFields.value;
    if (formObj.value.logtype) emitData.logtype = selectedLogtype.value;
    if (formObj.value.groupBy) emitData.groupBy = selectedGroupBy.value;
    emit('handleFunction', emitData,taskFilter.value);
    submitted.value = true;
};


// Cancel function
const handleTabCheck = () => {
    formObj.value={};
    emit('closeSidebar', false);
};

const handleFormUpdate = (updatedFormObj) => {
    formObj.value = updatedFormObj
};
// Work-by-Category card — persist the category→task-type map from the embedded
// mapper into the form object (emitted through the normal submit path).
const updateCategoryMap = (val) => {
    if (formObj.value.categoryMap) formObj.value.categoryMap.value = val;
};
const updateData = (val,field) => {
    if(field?.label === 'show_assignees'){
        selectedUser.value = val;
    }else if(field?.label === 'location'){
        selectedProjects.value = val;
    }else if(field?.label === 'status'){
        selectedStatus.value = val;
    }else if(field?.label === 'measure'){
        selectedMeasure.value = val.id;
    }else if(field?.label === 'calculation'){
        selectedCalculation.value = val.id;
    }else if(field?.label === 'timerange'){
        selectedTimeRange.value = val.id;
    }else if(field?.label === 'logtype'){
        selectedLogtype.value = val.id;
    }else if(field?.label === 'group_by'){
        selectedGroupBy.value = val.id;
    }else if(field?.label === 'fields'){
        selectedFields.value = val;
    }
};
const validateItems = (inputs) => {
    let isValid = true; // Assume the array is valid initially
    const chechEmptyArray = inputs.filter((x) => !Object.keys(x.name).length);
    if(chechEmptyArray && chechEmptyArray.length > 0){
        return isValid;
    }
    inputs?.forEach(item => {
        item.isValidate = true;

        if (typeof item.name !== "object" || Object.keys(item.name).length === 0) {
            item.isValidate = false;
        }
        if (typeof item.comparison !== "object" || Object.keys(item.comparison).length === 0) {
            item.isValidate = false;
        }
        if (item.name.value === "DueDate") {
            if (item.values.length === 0) {
                item.isValidate = false;
            }
            if(item.values.includes('Date range') && item.date === ''){
                item.isValidate = false;
            }
        } else {
            if (!Array.isArray(item.values) || item.values.length === 0) {
                item.isValidate = false;
            }
        }
        if (item.isValidate === false) {
            isValid = false;
        }
    });
    return isValid;
}

</script>

<style scoped src="./style.css"></style>