<template>
    <teleport to="body">
        <div v-if="quickCreate.open" class="qct-layer">
            <div class="qct-backdrop" aria-hidden="true" @click="dismiss"></div>
            <div
                ref="dialogEl"
                class="qct"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="ids.heading"
                tabindex="-1"
                @keydown="onKey"
            >
                <h2 :id="ids.heading" class="qct__heading">{{ $t('QuickCreate.title') }}</h2>
                <input
                    ref="nameEl"
                    v-model="name"
                    type="text"
                    class="qct__name"
                    data-field="title"
                    maxlength="250"
                    autocomplete="off"
                    :aria-label="$t('QuickCreate.name_label')"
                    :placeholder="$t('QuickCreate.name_placeholder')"
                    :aria-invalid="error ? 'true' : 'false'"
                    :aria-describedby="error ? ids.error : undefined"
                    @input="error = ''"
                />

                <div class="qct__where">
                    <label class="qct__field">
                        <span class="qct__label">{{ $t('QuickCreate.project') }}</span>
                        <select v-model="projectId" class="qct__select" data-field="project" :disabled="!options.length">
                            <option v-if="!options.length" value="">{{ preparing ? $t('QuickCreate.loading') : $t('QuickCreate.no_projects') }}</option>
                            <option v-for="p in options" :key="p._id" :value="String(p._id)">{{ p.isPersonal ? $t('QuickCreate.personal_list') : p.ProjectName }}</option>
                        </select>
                    </label>
                    <label v-if="lists.length > 1" class="qct__field">
                        <span class="qct__label">{{ $t('QuickCreate.list') }}</span>
                        <select v-model="sprintId" class="qct__select" data-field="list">
                            <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.folderName ? `${l.folderName} / ${l.name}` : l.name }}</option>
                        </select>
                    </label>
                </div>

                <div v-if="project" class="qct__row" role="group" :aria-label="$t('QuickCreate.properties')">
                    <label class="qct__chip">
                        <span class="ah-sr-only">{{ $t('QuickCreate.status') }}</span>
                        <span class="qct__dot" :style="{ background: statusColor }" aria-hidden="true"></span>
                        <select v-model="statusKey" data-field="status">
                            <option v-for="s in statuses" :key="s.key" :value="String(s.key)">{{ s.name }}</option>
                        </select>
                    </label>
                    <label class="qct__chip">
                        <span class="ah-sr-only">{{ $t('QuickCreate.assignee') }}</span>
                        <ShellIcon name="user" :size="13" />
                        <select v-model="assigneeId" data-field="assignee">
                            <option value="">{{ $t('QuickCreate.unassigned') }}</option>
                            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
                        </select>
                    </label>
                    <label class="qct__chip">
                        <span class="ah-sr-only">{{ $t('QuickCreate.due_date') }}</span>
                        <ShellIcon name="calendar" :size="13" />
                        <input v-model="due" type="date" data-field="due" />
                    </label>
                    <label v-if="showPriority" class="qct__chip">
                        <span class="ah-sr-only">{{ $t('QuickCreate.priority') }}</span>
                        <ShellIcon name="flag" :size="13" />
                        <select v-model="priority" data-field="priority">
                            <option v-for="p in priorities" :key="p.value" :value="p.value">{{ p.name }}</option>
                        </select>
                    </label>
                </div>

                <p v-if="error" :id="ids.error" class="qct__error" role="alert">{{ error }}</p>

                <div class="qct__foot">
                    <label class="qct__another">
                        <input v-model="keepOpen" type="checkbox" data-field="another" />
                        <span>{{ $t('QuickCreate.create_another') }}</span>
                    </label>
                    <span class="qct__hints" aria-hidden="true">
                        <kbd class="ah-kbd">↵</kbd> {{ $t('QuickCreate.hint_create') }}
                        <kbd class="ah-kbd">{{ modEnter }}</kbd> {{ $t('QuickCreate.hint_open') }}
                    </span>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="dismiss">{{ $t('QuickCreate.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="submit(keepOpen ? 'another' : 'create')">
                        {{ busy ? $t('QuickCreate.creating') : $t('QuickCreate.create') }}
                    </button>
                </div>
            </div>
        </div>
        <div class="qct-done-region" role="status" aria-live="polite">
            <div v-if="created" class="qct-done" data-created>
                <span>{{ $t('QuickCreate.created') }}</span>
                <button type="button" class="qct-done__open" @click="openCreated">{{ $t('QuickCreate.open') }}</button>
            </div>
        </div>
    </teleport>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import moment from "moment";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import taskClass from "@/utils/TaskOperations";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { taskPlanPermission } from "@/composable/commonFunction";
import { useFocusTrap } from "@/composable/useFocusTrap";
import { mutateArrangeProjectRules } from "@/store/Settings/mutations";
import { usePersonalList } from "@/components/molecules/Home/usePersonalList";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import { isMacPlatform } from "@/components/molecules/AdvanceSearch/paletteKeys";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import {
    closeQuickCreate,
    creatableProjects,
    defaultStatus,
    hasOpenDialog,
    hasPriorityApp,
    isCreateTaskShortcut,
    listsOf,
    openQuickCreate,
    pickDefaultProject,
    pickDefaultSprint,
    quickCreate,
    readDraft,
    readLastProject,
    rememberLastProject,
    saveDraft,
    submitIntent
} from "./quickCreateTask";

defineOptions({ name: "QuickCreateTask" });

const DONE_MS = 6000;

const { t } = useI18n();
const route = useRoute();
const { getters, commit } = useStore();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();
const companyId = inject("$companyId");
const userId = inject("$userId");
const personalList = usePersonalList({ companyId, userId });

const uid = `qct-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading`, error: `${uid}-error` };

const dialogEl = ref(null);
const nameEl = ref(null);
const name = ref("");
const projectId = ref("");
const sprintId = ref("");
const lists = ref([]);
const statusKey = ref("");
const assigneeId = ref("");
const due = ref("");
const priority = ref("MEDIUM");
const keepOpen = ref(false);
const busy = ref(false);
const error = ref("");
const preparing = ref(false);
const created = ref(null);
const personalSprint = ref(null);
const projectRules = reactive({});

let prepared = Promise.resolve();
let listsLoaded = Promise.resolve();
let doneTimer = null;

useFocusTrap(dialogEl, computed(() => quickCreate.open));

const modEnter = isMacPlatform() ? "⌘↵" : t("QuickCreate.key_ctrl_enter");
const me = computed(() => String(userId?.value || ""));
const cid = computed(() => String(companyId?.value || ""));
const allProjects = computed(() => getters["projectData/allProjects"]?.data || []);

const storeRulesFor = (pid) => (getters["settings/projectRawRules"] || []).some((r) => String(r.projectId) === String(pid));

/* Project-specific permissions live in one store slot that belongs to the project on screen,
 * so any other project's rules are read into a local copy instead of replacing that slot. */
function check(path, project) {
    if (project.isGlobalPermission !== false) return checkPermission(path, true);
    if (storeRulesFor(project._id)) return checkPermission(path, false);
    const rules = projectRules[project._id];
    if (!rules) return null;
    return checkPermission(path, false, {
        gettersVal: { "settings/companyUserDetail": getters["settings/companyUserDetail"], "settings/projectRules": rules, "settings/rules": getters["settings/rules"] }
    });
}

function loadProjectRules(project) {
    const pid = String(project._id);
    if (projectRules[pid] || storeRulesFor(pid)) return Promise.resolve();
    return apiRequest("get", `${env.PROJECTRULES}/${pid}`)
        .then((res) => {
            const scratch = {};
            mutateArrangeProjectRules(scratch, { op: "added", data: Array.isArray(res?.data) ? res.data : [], projectId: pid });
            projectRules[pid] = scratch.projectRules || {};
        })
        .catch((e) => console.error("ERROR in quick create project rules: ", e));
}

const options = computed(() => creatableProjects(allProjects.value, check));
const project = computed(() => options.value.find((p) => String(p._id) === String(projectId.value)) || null);
const statuses = computed(() => project.value?.taskStatusData || []);
const statusColor = computed(() => {
    const s = statuses.value.find((x) => String(x.key) === String(statusKey.value));
    return s?.bgColor || s?.textColor || "var(--ink-3)";
});
const showPriority = computed(() => hasPriorityApp(project.value, getters["settings/selectedCompany"]));
const priorities = computed(() => {
    const list = getters["settings/companyPriority"] || [];
    return list.length ? list : ["URGENT", "HIGH", "MEDIUM", "LOW"].map((value) => ({ value, name: t(`Home.priority_${value.toLowerCase()}`) }));
});
const members = computed(() => {
    const p = project.value;
    if (!p) return [];
    const everyone = p.isPersonal || check("task.task_assignee", p) !== true ? [me.value] : (p.AssigneeUserId || []).map(String);
    return everyone.filter(Boolean).map((id) => ({ id, name: getUser(id)?.Employee_Name || "" })).filter((m) => m.name);
});
const selectedList = computed(() => lists.value.find((l) => l.id === sprintId.value) || null);

const routeProjectId = () => {
    const routeName = String(route?.name || "");
    if (routeName === "PersonalList") return String(allProjects.value.find((p) => p.isPersonal)?._id || "");
    if (!routeName.startsWith("Project") || routeName === "Projects") return "";
    return String(route.params?.id || "");
};

function prepare() {
    preparing.value = true;
    const personal = personalList.ensure()
        .then((res) => { personalSprint.value = res?.sprint || null; })
        .catch((e) => console.error("ERROR in quick create personal list: ", e));
    const rules = allProjects.value.filter((p) => p.isGlobalPermission === false).map(loadProjectRules);
    return Promise.all([personal, ...rules]).finally(() => {
        preparing.value = false;
        if (!quickCreate.open) return;
        projectId.value = pickDefaultProject({
            requestedId: quickCreate.projectId,
            routeProjectId: routeProjectId(),
            lastUsedId: readLastProject(cid.value, me.value),
            projects: options.value
        });
    });
}

function loadLists(p) {
    if (!p) return Promise.resolve([]);
    if (p.isPersonal) {
        const s = personalSprint.value;
        return Promise.resolve(s ? listsOf([s]) : []);
    }
    const base = `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${p._id}`;
    return Promise.all([
        apiRequest("get", `${base}?collection=sprints`).catch(() => ({ data: [] })),
        apiRequest("get", `${base}?collection=folders`).catch(() => ({ data: [] }))
    ]).then(([sprints, folders]) => listsOf(Array.isArray(sprints?.data) ? sprints.data : [], Array.isArray(folders?.data) ? folders.data : []));
}

function resetFields(p) {
    const s = defaultStatus(p);
    statusKey.value = s ? String(s.key) : "";
    assigneeId.value = members.value.some((m) => m.id === me.value) ? me.value : "";
    if (!priorities.value.some((x) => x.value === priority.value)) priority.value = priorities.value[0]?.value || "MEDIUM";
}

watch(project, (p, was) => {
    if (p && was && String(p._id) === String(was._id)) return;
    lists.value = [];
    sprintId.value = "";
    if (!p) return;
    resetFields(p);
    const pid = String(p._id);
    listsLoaded = loadLists(p).then((found) => {
        if (String(projectId.value) !== pid) return;
        lists.value = found;
        const preferred = quickCreate.sprintId || (String(route?.params?.id || "") === pid ? String(route?.params?.sprintId || "") : "");
        sprintId.value = pickDefaultSprint(found, preferred);
    });
});

const focusTitle = () => nextTick(() => nameEl.value?.focus());

watch(() => quickCreate.open, (on) => {
    if (!on) return;
    error.value = "";
    name.value = readDraft();
    due.value = "";
    priority.value = "MEDIUM";
    projectId.value = "";
    prepared = prepare();
    focusTitle();
}, { immediate: true });

function dismiss() {
    saveDraft(name.value);
    closeQuickCreate();
}

function showCreated(task) {
    created.value = task;
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => { created.value = null; }, DONE_MS);
}

function openCreated() {
    const task = created.value;
    created.value = null;
    clearTimeout(doneTimer);
    if (task) openTask(task);
}

function taskPayload(p, list, status, title) {
    const assignees = assigneeId.value ? [assigneeId.value] : [];
    const dueDate = due.value ? moment(due.value, "YYYY-MM-DD").endOf("day").toDate() : "";
    const type = (p.taskTypeCounts || [])[0] || {};
    const sprintArray = { id: list.id, name: list.name, value: list.value };
    if (list.folderId) Object.assign(sprintArray, { folderId: list.folderId, folderName: list.folderName });
    const data = {
        TaskName: title,
        TaskKey: "--",
        AssigneeUserId: assignees,
        watchers: [...new Set([...assignees, me.value])],
        DueDate: dueDate,
        dueDateDeadLine: dueDate ? [{ date: dueDate }] : [],
        TaskType: type.value || type.name || "",
        TaskTypeKey: type.key,
        ParentTaskId: "",
        ProjectID: p._id,
        CompanyId: cid.value,
        status: { text: status.name, key: status.key, value: status.value, type: status.type },
        isParentTask: true,
        Task_Leader: me.value,
        sprintArray,
        Task_Priority: showPriority.value ? priority.value : "MEDIUM",
        deletedStatusKey: 0,
        sprintId: list.id,
        statusType: status.type,
        statusKey: status.key
    };
    if (list.folderId) data.folderObjId = list.folderId;
    return data;
}

function bumpListCount(p, list) {
    const stored = list.folderId ? p.sprintsfolders?.[list.folderId]?.sprintsObj?.[list.id] : p.sprintsObj?.[list.id];
    if (stored) commit("projectData/mutateSprints", { op: "modified", data: { ...stored, tasks: (Number(stored.tasks) || 0) + 1 } });
}

async function submit(intent) {
    if (busy.value || !intent) return;
    const title = name.value.trim();
    if (title.length < 3) {
        error.value = t("QuickCreate.name_too_short");
        focusTitle();
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        await prepared;
        await listsLoaded;
        const p = project.value;
        const list = selectedList.value;
        const status = statuses.value.find((s) => String(s.key) === String(statusKey.value)) || defaultStatus(p);
        if (!p || !list || !status) {
            error.value = t("QuickCreate.no_list");
            return;
        }
        const allowed = await checkTaskPerSprintPermisssion(list.id).catch(() => true);
        if (!allowed) {
            error.value = t("Toast.create_task_plan_limit_message").replace("TASK_SPRINT", list.name);
            return;
        }
        const user = getUser(me.value) || {};
        const result = await taskClass.create({
            data: taskPayload(p, list, status, title),
            user: { id: user.id || user._id || me.value, Employee_Name: user.Employee_Name, companyOwnerId: getters["settings/companyOwnerDetail"]?.userId },
            projectData: { _id: p._id, CompanyId: p.CompanyId, lastTaskId: p.lastTaskId || 0, ProjectName: p.ProjectName, ProjectCode: p.ProjectCode || "" },
            indexObj: { indexName: "groupByStatusIndex", searchKey: "statusKey", searchValue: status.key }
        });
        if (result?.isUpgrade) {
            error.value = t("Toast.create_task_plan_limit_message").replace("TASK_SPRINT", list.name);
            return;
        }
        if (!result?.status || !result.id) {
            error.value = t("QuickCreate.create_failed");
            return;
        }
        rememberLastProject(cid.value, me.value, p._id);
        bumpListCount(p, list);
        const task = { companyId: cid.value, projectId: String(p._id), sprintId: list.id, folderId: list.folderId, taskId: String(result.id) };
        name.value = "";
        saveDraft("");
        if (intent === "open") {
            closeQuickCreate();
            openTask(task);
            return;
        }
        showCreated(task);
        if (intent === "another") focusTitle();
        else closeQuickCreate();
    } catch (e) {
        console.error("ERROR in quick create task: ", e);
        error.value = t("QuickCreate.create_failed");
    } finally {
        busy.value = false;
    }
}

function onKey(e) {
    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
    }
    const intent = submitIntent(e, { keepOpen: keepOpen.value });
    if (!intent) return;
    // Enter keeps its own meaning on buttons, selects and the checkbox; Cmd/Ctrl+Enter works from anywhere.
    if (intent !== "open" && e.target !== nameEl.value) return;
    e.preventDefault();
    submit(intent);
}

function onShortcut(e) {
    if (quickCreate.open || !isCreateTaskShortcut(e, { dialogOpen: hasOpenDialog() })) return;
    e.preventDefault();
    openQuickCreate();
}

onMounted(() => document.addEventListener("keydown", onShortcut));
onBeforeUnmount(() => {
    document.removeEventListener("keydown", onShortcut);
    clearTimeout(doneTimer);
});
</script>

<style scoped>
.qct-layer { position: fixed; inset: 0; z-index: 1000; }
.qct-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .36); }
.qct {
    position: absolute; top: 14vh; left: 50%; transform: translateX(-50%);
    box-sizing: border-box; width: 580px; max-width: calc(100vw - 32px); max-height: 80dvh; overflow: auto;
    display: flex; flex-direction: column; gap: 12px; padding: 16px;
    border-radius: var(--r-modal, 16px); background: var(--surface); color: var(--ink);
    box-shadow: var(--shadow-modal); font-family: var(--font-ui); font-size: 12.5px;
}
.qct:focus { outline: none; }
.qct__heading { margin: 0; font: 600 11px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.qct__name {
    width: 100%; box-sizing: border-box; border: 0; outline: none; background: transparent; padding: 2px 0;
    font: 500 17px/1.35 var(--font-ui); color: var(--ink);
}
.qct__name::placeholder { color: var(--ink-2); }
.qct__name[aria-invalid="true"] { box-shadow: inset 0 -2px 0 var(--danger); }
.qct__where { display: flex; flex-wrap: wrap; gap: 8px; }
.qct__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 180px; margin: 0; }
.qct__label { font: 500 11px/1 var(--font-ui); color: var(--ink-label); }
.qct__select, .qct__chip select, .qct__chip input {
    font: 400 12.5px/1.2 var(--font-ui); color: var(--ink); background: transparent; border: 0; outline: none; min-width: 0;
}
.qct__select { border: 1px solid var(--border); border-radius: var(--r-input, 8px); padding: 7px 8px; background: var(--surface); }
.qct__row { display: flex; flex-wrap: wrap; gap: 6px; }
.qct__chip {
    display: inline-flex; align-items: center; gap: 6px; margin: 0; max-width: 100%;
    padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--ink-label); background: var(--surface);
}
.qct__chip:focus-within, .qct__select:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.qct__chip select { max-width: 160px; cursor: pointer; }
.qct__chip input[type="date"] { color-scheme: light dark; }
.qct__dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.qct__error { margin: 0; color: var(--danger); font-size: 12px; }
.qct__foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--hairline); padding-top: 12px; }
.qct__another { display: inline-flex; align-items: center; gap: 6px; margin: 0 auto 0 0; color: var(--ink-label); cursor: pointer; }
.qct__hints { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-2); font-size: 11px; }
.qct-done-region { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 1001; pointer-events: none; }
.qct-done {
    pointer-events: auto; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px;
    background: var(--rail, #17161c); color: #fff; box-shadow: var(--shadow-pop); font: 500 13px/1.2 var(--font-ui); white-space: nowrap;
}
.qct-done__open { border: 0; background: transparent; color: #fff; font: 600 13px/1 var(--font-ui); text-decoration: underline; cursor: pointer; padding: 4px; }
.qct-done__open:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
@media (max-width: 767px) {
    .qct { top: 8dvh; }
    .qct__hints { display: none; }
    .qct-done-region { bottom: calc(var(--tabbar-h, 56px) + env(safe-area-inset-bottom) + 12px); }
}
</style>
